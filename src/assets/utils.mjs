import Papa from 'papaparse';
import { tw2cn, cn2tw } from 'cjk-conv';
import { TOTAL_FREQUENCY_ENTRIES, TOCFL_LEVEL_MAP, MAX_RELATED, REPLACED_CHARS } from './consts'

const re_varients = /^((old )?variant|surname).*/
const re_zhletters = /\p{Script=Han}/u

export const fetchcsv = async () => {
    const parseFile = (path) => {
        return new Promise(resolve => {
            Papa.parse(path, {
                download: true,
                header: true,
                complete: (log) => resolve(log.data)
            });
        });
    };
    let parsedData = await parseFile("/merged_dict.csv");

    return parsedData;
}

const createregexps = (text) => {
    const simp = tw2cn(text);
    const trad = cn2tw(text);
    let res = '';
    let char_t, char_s;
    for (let i = 0; i< simp.length; i++) {
        char_s = simp.charAt(i);
        char_t = trad.charAt(i);
        if (char_s === char_t) res += char_t;
        else res+= `[${char_s}${char_t}]`;
    }

    let re_includes= new RegExp(`(?=[\\u4E00-\\u9FFF]*${res})[\\u4E00-\\u9FFF]{${text.length+1},}`)
    
    return {re_complete: new RegExp(`^${res}$`), re_includes};
}

export const calcimportance = (word) => {
    const freq = (Number(word.frequency) || TOTAL_FREQUENCY_ENTRIES)/TOTAL_FREQUENCY_ENTRIES;
    const hsk = !word.hsk2 && !word.hsk3 ? 1 : (Number(word.hsk2 || 7) + Number(word.hsk3 == "7+" ? 7 : (word.hsk3 || 10)))/(7+10);
    const tocfl = (TOCFL_LEVEL_MAP[word.tocfl] || 6)/6;
    return(freq+hsk+tocfl)
}

const chinesefindwords = (dict, sentence) => {
    let result = [];
    let curr_stack = ''

    let temp_chars = [];
    let temp_word = [];

    let setVars = (new_chars, new_stack) => {
        if(temp_word.length) {
            const {re_includes} = createregexps(curr_stack);
            const including = searchReInDict(dict, re_includes).sort((a,b)=> calcimportance(a) > calcimportance(b) ? 1 : -1).slice(0, MAX_RELATED);

            result.push({
                chars: temp_chars.filter(w => w.simplified !== curr_stack && w.traditional !== curr_stack),
                including,
                specific: reorgspecific(temp_word),
                variants: [] //TODO
            })
        }
        curr_stack = new_stack;
        temp_chars = new_chars;
        temp_word = new_chars;
    }

    for (let ch of sentence) {
        if (ch.match(re_zhletters)) {

            const {re_complete : re_comp_char} = createregexps(ch);
            const {re_complete : re_comp_stack} = createregexps(curr_stack + ch);

            let chars = searchReInDict(dict, re_comp_char);
            let words = curr_stack ? searchReInDict(dict, re_comp_stack) : chars;
        
            if (words.length) {
                temp_chars.push(...chars);
                curr_stack+=ch;
                temp_word = words;
            } else {
                setVars(chars, ch)
            }
        } else {
            setVars([], '')
        }
    }

    setVars([], '')

    return result
}

const searchReInDict = (dict, re) => {
    let res= []
    dict.forEach(w => {
        if (w.simplified.match(re) || w.traditional.match(re)) res.push(w);
    })
    return res;
}

const reorgspecific = arr => {
    const res= {};
    for (let def of arr) {
        if (res[def.traditional]) {res[def.traditional].data.push({meaning: def.meaning, pinyin: def.pinyin})}
        else {res[def.traditional] = {
            traditional:def.traditional,
            simplified: def.simplified,
            frequency: def.frequency,
            hsk2: def.hsk2,
            hsk3: def.hsk3,
            tocfl: def.tocfl,
            data: [{meaning: def.meaning, pinyin: def.pinyin}]
        }}
    }
    return res;
}

const englishfindword = (dict,text) => {
    const re_word = new RegExp(`^(?:.* /?)?${text.toLowerCase()}(?:/? .*)$`);
    let relevant = dict.filter(w => {
        if (w.meaning.toLowerCase().match(re_word)) return true;
        return false;
    }).sort((a,b)=> calcimportance(a) > calcimportance(b) ? 1 : -1);
    relevant = relevant.slice(0, MAX_RELATED*2);
    const res = relevant.map(i => {return {specific: reorgspecific([i])}})
    return(res);
}

export const findWord = (dict,text) => {
    const res = (text.match(/^[a-zA-Z]/)) ? englishfindword(dict,text) : chinesefindwords(dict, text.trim());
    return res
}

export const fixDef = (str) => {
    return REPLACED_CHARS.reduce((acc, i) => acc.replaceAll(i[1], i[0]), str)
}