import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import axios from 'axios';
import {
    Play, Loader2, Code2, Swords, Trophy, Zap, Clock, ChevronLeft, Scissors,
    Maximize2, Minimize2, UploadCloud, FileCode
} from 'lucide-react';
import { useGameSocket } from '../hooks/useGameSocket';
import BattleIntro from '../components/BattleIntro';
import './Game.css';

/* ─── Types ─────────────────────────────────────────────────── */
interface Hint { id: string; content: string; order_index: number; }
interface TeamState {
    name: string; knivesUnlocked: number; knivesUsed: number;
    solved: number[]; pendingGridPicks: number;
    code: string;
}
interface Room {
    code: string; phase: string;
    teams: { A: TeamState; B: TeamState };
    grid: (null | 'A' | 'B')[];
    currentQuestionIdx: number; questionCount: number;
    winner: null | string;
    lastSolvedBy: null | string; isBonusQuestion: boolean;
    questionStartedAt: number | null;
}

const TEAM_COLORS = { A: '#3b82f6', B: '#8b5cf6' };
const TEAM_BG = { A: 'rgba(59, 130, 246, 0.06)', B: 'rgba(139, 92, 246, 0.06)' };

// ── Refresh persistence helpers ───────────────────────────────
const SESSION_KEY = 'ca_game_state';
type GameNavState = { room: Room; myTeam: 'A' | 'B'; teamCode: string; teamName: string };
function loadGameSession(): GameNavState | null {
    try { const s = sessionStorage.getItem(SESSION_KEY); return s ? JSON.parse(s) as GameNavState : null; } catch { return null; }
}
function codeKey(roomCode: string, qIdx: number, team: string, lang: string) {
    return `ca_code_${roomCode}_q${qIdx}_${team}_${lang}`;
}
function loadCode(roomCode: string, qIdx: number, team: string, lang: string): string | null {
    try { return localStorage.getItem(codeKey(roomCode, qIdx, team, lang)); } catch { return null; }
}
function saveCode(roomCode: string, qIdx: number, team: string, lang: string, code: string) {
    try { localStorage.setItem(codeKey(roomCode, qIdx, team, lang), code); } catch {}
}
function clearCode(roomCode: string, qIdx: number, team: string, lang: string) {
    try { localStorage.removeItem(codeKey(roomCode, qIdx, team, lang)); } catch {}
}

const CPP_TEMPLATE = `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(NULL);

    // Write your solution here

    return 0;
}
`;

const C_TEMPLATE = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main() {
    // Write your solution here

    return 0;
}
`;

const handleEditorBeforeMount = (monaco: any) => {
    monaco.languages.registerCompletionItemProvider('cpp', {
        triggerCharacters: ['#', '<', '.', ':', ' ', '('],
        provideCompletionItems: (_model: any, _position: any) => {
            const mk = (label: string, kind: any, insert: string, detail: string, doc?: string, snippet = false) => ({
                label, kind, detail,
                documentation: { value: doc || '' },
                insertText: insert,
                insertTextRules: snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : 0,
            });
            const K = monaco.languages.CompletionItemKind;
            return { suggestions: [
                // ── Includes ────────────────────────────────────────────
                mk('#include <bits/stdc++.h>', K.Module, '#include <bits/stdc++.h>', 'Include all standard headers'),
                mk('#include <iostream>',      K.Module, '#include <iostream>',       'Standard I/O'),
                mk('#include <vector>',        K.Module, '#include <vector>',         'std::vector'),
                mk('#include <string>',        K.Module, '#include <string>',         'std::string'),
                mk('#include <algorithm>',     K.Module, '#include <algorithm>',      'sort, find, etc.'),
                mk('#include <map>',           K.Module, '#include <map>',            'std::map'),
                mk('#include <set>',           K.Module, '#include <set>',            'std::set'),
                mk('#include <unordered_map>', K.Module, '#include <unordered_map>',  'std::unordered_map'),
                mk('#include <unordered_set>', K.Module, '#include <unordered_set>',  'std::unordered_set'),
                mk('#include <queue>',         K.Module, '#include <queue>',          'std::queue / priority_queue'),
                mk('#include <stack>',         K.Module, '#include <stack>',          'std::stack'),
                mk('#include <deque>',         K.Module, '#include <deque>',          'std::deque'),
                mk('#include <cmath>',         K.Module, '#include <cmath>',          'sqrt, pow, abs, etc.'),
                mk('#include <climits>',       K.Module, '#include <climits>',        'INT_MAX, INT_MIN, etc.'),
                mk('#include <numeric>',       K.Module, '#include <numeric>',        'accumulate, gcd, lcm'),
                // ── Types ───────────────────────────────────────────────
                mk('int',       K.Keyword, 'int',        '32-bit integer'),
                mk('long long', K.Keyword, 'long long',  '64-bit integer'),
                mk('double',    K.Keyword, 'double',     '64-bit float'),
                mk('float',     K.Keyword, 'float',      '32-bit float'),
                mk('bool',      K.Keyword, 'bool',       'Boolean'),
                mk('char',      K.Keyword, 'char',       '8-bit character'),
                mk('string',    K.Keyword, 'string',     'std::string'),
                mk('auto',      K.Keyword, 'auto',       'Automatic type deduction'),
                mk('void',      K.Keyword, 'void',       'No return / generic'),
                mk('size_t',    K.Keyword, 'size_t',     'Unsigned size type'),
                // ── STL Containers ──────────────────────────────────────
                mk('vector<int>',              K.Class, 'vector<${1:int}>', 'Dynamic array', 'std::vector', true),
                mk('vector<long long>',        K.Class, 'vector<long long>', 'Dynamic array of long long'),
                mk('vector<string>',           K.Class, 'vector<string>', 'Dynamic array of strings'),
                mk('map<int,int>',             K.Class, 'map<${1:int}, ${2:int}>', 'Ordered map', '', true),
                mk('unordered_map<int,int>',   K.Class, 'unordered_map<${1:int}, ${2:int}>', 'Hash map', '', true),
                mk('set<int>',                 K.Class, 'set<${1:int}>', 'Ordered set', '', true),
                mk('unordered_set<int>',       K.Class, 'unordered_set<${1:int}>', 'Hash set', '', true),
                mk('pair<int,int>',            K.Class, 'pair<${1:int}, ${2:int}>', 'std::pair', '', true),
                mk('priority_queue<int>',      K.Class, 'priority_queue<${1:int}>', 'Max-heap by default', '', true),
                mk('stack<int>',               K.Class, 'stack<${1:int}>', 'LIFO stack', '', true),
                mk('queue<int>',               K.Class, 'queue<${1:int}>', 'FIFO queue', '', true),
                mk('deque<int>',               K.Class, 'deque<${1:int}>', 'Double-ended queue', '', true),
                // ── Keywords ────────────────────────────────────────────
                mk('return',    K.Keyword, 'return ',    'Return statement'),
                mk('const',     K.Keyword, 'const ',     'Constant qualifier'),
                mk('constexpr', K.Keyword, 'constexpr ', 'Compile-time constant'),
                mk('nullptr',   K.Keyword, 'nullptr',    'Null pointer'),
                mk('true',      K.Keyword, 'true',       'Boolean true'),
                mk('false',     K.Keyword, 'false',      'Boolean false'),
                mk('sizeof',    K.Function,'sizeof(',    'Size of type'),
                mk('typedef',   K.Keyword, 'typedef ',   'Type alias'),
                mk('using',     K.Keyword, 'using ',     'Namespace / alias'),
                mk('namespace', K.Keyword, 'namespace ', 'Namespace'),
                mk('struct',    K.Keyword, 'struct ${1:Name} {\n    ${2}\n};', 'Struct definition', '', true),
                mk('class',     K.Keyword, 'class ${1:Name} {\npublic:\n    ${2}\n};', 'Class definition', '', true),
                // ── I/O ─────────────────────────────────────────────────
                mk('cin >>',  K.Function, 'cin >> ${1:var};', 'Standard input', '', true),
                mk('cout <<', K.Function, 'cout << ${1:val} << "\\n";', 'Standard output', '', true),
                mk('cout << endl', K.Function, 'cout << ${1:val} << endl;', 'Output with endl'),
                mk('getline',  K.Function, 'getline(cin, ${1:str});', 'Read entire line', '', true),
                mk('printf',   K.Function, 'printf("${1:%d}\\n", ${2:val});', 'C printf', '', true),
                mk('scanf',    K.Function, 'scanf("${1:%d}", &${2:var});', 'C scanf', '', true),
                mk('ios_base::sync_with_stdio(false)', K.Function, 'ios_base::sync_with_stdio(false);\n    cin.tie(NULL);', 'Fast I/O'),
                // ── Algorithms ──────────────────────────────────────────
                mk('sort',          K.Function, 'sort(${1:v}.begin(), ${1:v}.end());', 'Sort ascending', '', true),
                mk('sort descending',K.Function,'sort(${1:v}.begin(), ${1:v}.end(), greater<${2:int}>());', 'Sort descending', '', true),
                mk('reverse',       K.Function, 'reverse(${1:v}.begin(), ${1:v}.end());', 'Reverse container', '', true),
                mk('max',           K.Function, 'max(${1:a}, ${2:b})', 'Maximum of two values', '', true),
                mk('min',           K.Function, 'min(${1:a}, ${2:b})', 'Minimum of two values', '', true),
                mk('abs',           K.Function, 'abs(${1:n})', 'Absolute value', '', true),
                mk('swap',          K.Function, 'swap(${1:a}, ${2:b});', 'Swap two values', '', true),
                mk('find',          K.Function, 'find(${1:v}.begin(), ${1:v}.end(), ${2:val})', 'Find element', '', true),
                mk('count',         K.Function, 'count(${1:v}.begin(), ${1:v}.end(), ${2:val})', 'Count occurrences', '', true),
                mk('lower_bound',   K.Function, 'lower_bound(${1:v}.begin(), ${1:v}.end(), ${2:val})', 'First >= val', '', true),
                mk('upper_bound',   K.Function, 'upper_bound(${1:v}.begin(), ${1:v}.end(), ${2:val})', 'First > val', '', true),
                mk('binary_search', K.Function, 'binary_search(${1:v}.begin(), ${1:v}.end(), ${2:val})', 'Binary search', '', true),
                mk('accumulate',    K.Function, 'accumulate(${1:v}.begin(), ${1:v}.end(), 0LL)', 'Sum of elements', '', true),
                mk('max_element',   K.Function, '*max_element(${1:v}.begin(), ${1:v}.end())', 'Max element', '', true),
                mk('min_element',   K.Function, '*min_element(${1:v}.begin(), ${1:v}.end())', 'Min element', '', true),
                mk('unique',        K.Function, 'unique(${1:v}.begin(), ${1:v}.end())', 'Remove consecutive duplicates', '', true),
                mk('fill',          K.Function, 'fill(${1:v}.begin(), ${1:v}.end(), ${2:0})', 'Fill with value', '', true),
                mk('__gcd',         K.Function, '__gcd(${1:a}, ${2:b})', 'GCD of two numbers', '', true),
                mk('gcd',           K.Function, 'gcd(${1:a}, ${2:b})', 'gcd (C++17)', '', true),
                mk('lcm',           K.Function, 'lcm(${1:a}, ${2:b})', 'lcm (C++17)', '', true),
                mk('sqrt',          K.Function, 'sqrt(${1:n})', 'Square root', '', true),
                mk('pow',           K.Function, 'pow(${1:base}, ${2:exp})', 'Power', '', true),
                mk('log',           K.Function, 'log(${1:x})', 'Natural log', '', true),
                mk('ceil',          K.Function, 'ceil(${1:x})', 'Ceiling', '', true),
                mk('floor',         K.Function, 'floor(${1:x})', 'Floor', '', true),
                mk('stoi',          K.Function, 'stoi(${1:str})', 'String to int', '', true),
                mk('stoll',         K.Function, 'stoll(${1:str})', 'String to long long', '', true),
                mk('to_string',     K.Function, 'to_string(${1:val})', 'Number to string', '', true),
                mk('next_permutation', K.Function, 'next_permutation(${1:v}.begin(), ${1:v}.end())', 'Next permutation', '', true),
                // ── Common Constants ────────────────────────────────────
                mk('INT_MAX',   K.Constant, 'INT_MAX',   '2147483647'),
                mk('INT_MIN',   K.Constant, 'INT_MIN',   '-2147483648'),
                mk('LLONG_MAX', K.Constant, 'LLONG_MAX', '9223372036854775807'),
                mk('LLONG_MIN', K.Constant, 'LLONG_MIN', '-9223372036854775808'),
                mk('1e9',       K.Constant, '1e9',       '1,000,000,000'),
                mk('1e18',      K.Constant, '1e18',      '1,000,000,000,000,000,000'),
                mk('MOD',       K.Constant, 'const int MOD = 1e9 + 7;', '1e9+7 modulus'),
                // ── Snippets ────────────────────────────────────────────
                mk('for i',      K.Snippet, 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n    ${3}\n}', 'for loop (int i)', '', true),
                mk('for ll',     K.Snippet, 'for (long long ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n    ${3}\n}', 'for loop (ll)', '', true),
                mk('for each',   K.Snippet, 'for (auto& ${1:x} : ${2:container}) {\n    ${3}\n}', 'Range-based for', '', true),
                mk('while',      K.Snippet, 'while (${1:condition}) {\n    ${2}\n}', 'while loop', '', true),
                mk('if',         K.Snippet, 'if (${1:condition}) {\n    ${2}\n}', 'if statement', '', true),
                mk('if else',    K.Snippet, 'if (${1:condition}) {\n    ${2}\n} else {\n    ${3}\n}', 'if-else', '', true),
                mk('lambda',     K.Snippet, 'auto ${1:fn} = [${2:&}](${3:int x}) {\n    return ${4:x};\n};', 'Lambda function', '', true),
                mk('function',   K.Snippet, '${1:int} ${2:solve}(${3}) {\n    ${4}\n}', 'Function definition', '', true),
                mk('main',       K.Snippet, 'int main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n    ${1}\n    return 0;\n}', 'main function', '', true),
                mk('solve loop', K.Snippet, 'int t;\ncin >> t;\nwhile (t--) {\n    ${1}\n}', 'Test case loop', '', true),
                mk('read vector',K.Snippet, 'int n;\ncin >> n;\nvector<${1:int}> ${2:v}(n);\nfor (auto& x : ${2:v}) cin >> x;', 'Read into vector', '', true),
                mk('debug',      K.Snippet, 'cerr << "${1:var} = " << ${1:var} << "\\n";', 'Debug print to stderr', '', true),
                mk('pii',        K.Snippet, 'pair<int, int>', 'pair<int,int>'),
                mk('vii',        K.Snippet, 'vector<pair<int,int>>', 'vector of pairs'),
            ]};
        }
    });
    // Set editor theme — clean white CodePie style
    monaco.editor.defineTheme('codepie-light', {
        base: 'vs',
        inherit: true,
        rules: [
            { token: 'keyword',    foreground: '2563eb', fontStyle: 'bold' },
            { token: 'type',       foreground: '059669' },
            { token: 'string',     foreground: 'd97706' },
            { token: 'number',     foreground: '7c3aed' },
            { token: 'comment',    foreground: '9ca3af', fontStyle: 'italic' },
            { token: 'delimiter',  foreground: '374151' },
            { token: 'identifier', foreground: '1e293b' },
            { token: 'variable',   foreground: '1e293b' },
            { token: 'function',   foreground: '0369a1' },
            { token: 'operator',   foreground: '374151' },
        ],
        colors: {
            'editor.background':              '#ffffff',
            'editor.foreground':              '#1e293b',
            'editor.lineHighlightBackground': '#f8fafc',
            'editor.selectionBackground':     '#bfdbfe',
            'editor.selectionHighlightBackground': '#dbeafe',
            'editorLineNumber.foreground':    '#94a3b8',
            'editorLineNumber.activeForeground': '#2563eb',
            'editorCursor.foreground':        '#2563eb',
            'editorIndentGuide.background':   '#e2e8f0',
            'editorIndentGuide.activeBackground': '#cbd5e1',
            'editorWhitespace.foreground':    '#e2e8f0',
            'editorBracketMatch.background':  '#dbeafe',
            'editorBracketMatch.border':      '#2563eb',
            'editorSuggestWidget.background': '#ffffff',
            'editorSuggestWidget.border':     '#e2e8f0',
            'editorSuggestWidget.selectedBackground': '#eff6ff',
            'editorSuggestWidget.foreground': '#1e293b',
            'scrollbarSlider.background':     '#e2e8f066',
            'scrollbarSlider.hoverBackground':'#cbd5e199',
        }
    });
};

export default function Game() {
    const location = useLocation();
    const navigate = useNavigate();
    // On refresh location.state is null — fall back to sessionStorage
    const rawState = location.state as GameNavState | null;
    const state = rawState ?? loadGameSession();

    // Persist state to sessionStorage whenever we have it from the router
    useEffect(() => {
        if (rawState) {
            try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(rawState)); } catch {}
        }
    }, [rawState]);

    useEffect(() => { if (!state) navigate('/'); }, [state, navigate]);
    if (!state) return null;

    const myTeam = state.myTeam;

    // ── Battle intro ─────────────────────────────────────────
    const [showBattleIntro, setShowBattleIntro] = useState(true);
    const handleBattleDone = useCallback(() => setShowBattleIntro(false), []);

    // ── SOCKET HOOK ──────────────────────────────────────────
    const [room, setRoom] = useState<Room>(state.room);
    const [questions, setQuestions] = useState<any[]>([]);
    const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
    const [execTime, setExecTime] = useState<number | null>(null);
    const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const [problemOpen, setProblemOpen] = useState(true);
    const [knifeMode, setKnifeMode] = useState(false);
    const [editorFullscreen, setEditorFullscreen] = useState(false);
    const [langChoice, setLangChoice] = useState<'cpp' | 'c'>('cpp');
    // ── Test Cases (LeetCode style) ───────────────────────────
    const [sampleTcs, setSampleTcs] = useState<{ id: string; input: string; expected_output: string }[]>([]);
    const [activeTcIdx, setActiveTcIdx] = useState(0);
    const [customTcInput, setCustomTcInput] = useState('');
    const [tcRuns, setTcRuns] = useState<{ output: string; passed: boolean; expected: string; time: number | null }[]>([]);
    // ── Submit state ─────────────────────────────────────────
    const [submitStatus, setSubmitStatus] = useState<'idle' | 'submitting' | 'accepted' | 'rejected' | 'error'>('idle');
    const [submitOutput, setSubmitOutput] = useState('');
    const [submitDetail, setSubmitDetail] = useState<{ passed: number; total: number; time: number | null } | null>(null);
    const [ioTab, setIoTab] = useState<'testcase' | 'result' | 'submit'>('testcase');

    // ── Hints state ──────────────────────────────────────────
    const [hints, setHints] = useState<Hint[]>([]);
    const [revealedHints, setRevealedHints] = useState<Set<number>>(new Set());

    const toggleHint = (i: number) => {
        setRevealedHints(prev => {
            const next = new Set(prev);
            next.has(i) ? next.delete(i) : next.add(i);
            return next;
        });
    };

    const timerRef = useRef<any>(null);

    const showToast = (msg: string, type: string = 'info') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3500);
    };

    const { send, connected } = useGameSocket(useCallback((msg: any) => {
        const type = msg.type;
        switch (type) {
            case 'room_updated': setRoom(msg.room); break;
            // Sync stale room state after reconnect
            case 'joined': setRoom(msg.room); break;

            case 'game_started':
                setRoom(msg.room);
                showToast('🚀 Game Started! Good luck.', 'success');
                break;

            // Knife phase (Q1-Q3): just advance question, no grid pick
            case 'knife_unlocked':
                setRoom(msg.room);
                if (msg.data?.teamId === myTeam) {
                    showToast('Solved! Pick your grid cell.', 'success');
                } else {
                    showToast('Opponent solved it first — they pick a cell.', 'info');
                }
                break;

            // Normal question → grid pick phase
            case 'question_solved':
                setRoom(msg.room);
                if (msg.data?.teamId === myTeam) {
                    showToast('Solved! Pick your grid cell.', 'success');
                } else {
                    showToast('Opponent solved it first — they pick a cell.', 'error');
                }
                break;

            // Bonus question → grid pick phase (2 cells)
            case 'bonus_solved':
                setRoom(msg.room);
                if (msg.data?.teamId === myTeam) {
                    showToast('Bonus solved! Pick 2 grid cells.', 'success');
                } else {
                    showToast('Opponent solved the bonus — they pick 2 cells.', 'error');
                }
                break;

            case 'grid_updated': setRoom(msg.room); break;

            case 'knife_used':
                setRoom(msg.room);
                if (msg.data?.teamId === myTeam) {
                    if (msg.data?.wasted) {
                        showToast('Knife wasted! Use your knife wisely — only strike when there is something to destroy.', 'warning');
                    } else {
                        showToast('Knife strike! Opponent\'s cell removed.', 'success');
                    }
                } else {
                    if (!msg.data?.wasted) {
                        showToast('Opponent used a knife on your cell!', 'error');
                    }
                }
                break;

            case 'game_over':
                setRoom(msg.room);
                break;

            case 'error': showToast(msg.message, 'error'); break;
        }
    }, [myTeam]));

    // Handshake and Fetch Questions
    useEffect(() => {
        if (connected) {
            send('join_with_team_code', { teamCode: state.teamCode, teamName: state.teamName });

            // Heartbeat to prevent ECONNABORTED/Timeout
            const ping = setInterval(() => send('ping'), 15000);
            return () => clearInterval(ping);
        }
    }, [connected, send, state.teamCode, state.teamName]);

    const [questionsError, setQuestionsError] = useState(false);

    const loadQuestions = useCallback(() => {
        setQuestionsError(false);
        const tryFetch = (attempt: number): Promise<void> =>
            axios.get(`${import.meta.env.VITE_API_URL || ''}/api/problems?published=true`)
                .then(res => {
                    const list = res.data?.problems ?? (Array.isArray(res.data) ? res.data : null);
                    if (list && list.length > 0) {
                        setQuestions(list);
                    } else if (attempt < 3) {
                        return new Promise<void>(r => setTimeout(r, 800 * attempt)).then(() => tryFetch(attempt + 1));
                    } else {
                        setQuestionsError(true);
                    }
                })
                .catch(() => {
                    if (attempt < 3) return new Promise<void>(r => setTimeout(r, 800 * attempt)).then(() => tryFetch(attempt + 1));
                    setQuestionsError(true);
                });
        tryFetch(1);
    }, []);

    useEffect(() => { loadQuestions(); }, [loadQuestions]);

    // Fetch sample test cases whenever question changes — clear OLD state immediately
    useEffect(() => {
        const qId = questions[room.currentQuestionIdx]?.id;

        // Clear all per-question state synchronously BEFORE the fetch
        setSampleTcs([]);
        setTcRuns([]);
        setActiveTcIdx(0);
        setCustomTcInput('');
        setRunStatus('idle');
        setIoTab('testcase');
        setSubmitStatus('idle');
        setSubmitOutput('');
        setSubmitDetail(null);
        setExecTime(null);
        // Restore saved code for this question, or fall back to template
        const initialCode = loadCode(room.code, room.currentQuestionIdx, myTeam, langChoice)
            ?? (langChoice === 'c' ? C_TEMPLATE : CPP_TEMPLATE);
        setRoom(prev => ({
            ...prev,
            teams: {
                ...prev.teams,
                [myTeam]: { ...prev.teams[myTeam], code: initialCode }
            }
        }));

        if (!qId) return;
        axios.get(`${import.meta.env.VITE_API_URL || ''}/api/problems/${qId}/testcases`)
            .then(res => {
                setSampleTcs(res.data.samples || []);
            })
            .catch(() => setSampleTcs([]));
        // Fetch hints for this question
        setHints([]);
        setRevealedHints(new Set());
        axios.get(`${import.meta.env.VITE_API_URL || ''}/api/problems/${qId}/hints`)
            .then(res => setHints(res.data.hints || []))
            .catch(() => setHints([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [questions, room.currentQuestionIdx]);

    // When language switches, restore saved code for that lang or fall back to template
    useEffect(() => {
        const saved = loadCode(room.code, room.currentQuestionIdx, myTeam, langChoice)
            ?? (langChoice === 'c' ? C_TEMPLATE : CPP_TEMPLATE);
        setRoom(prev => ({
            ...prev,
            teams: {
                ...prev.teams,
                [myTeam]: { ...prev.teams[myTeam], code: saved }
            }
        }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [langChoice]);

    // Timer Logic
    useEffect(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (room.phase === 'playing' && room.questionStartedAt) {
            timerRef.current = setInterval(() => {
                setElapsed(Math.floor((Date.now() - (room.questionStartedAt || 0)) / 1000));
            }, 1000);
        } else {
            setElapsed(0);
        }
        return () => timerRef.current && clearInterval(timerRef.current);
    }, [room.phase, room.questionStartedAt, room.currentQuestionIdx]);

    const hh = Math.floor(elapsed / 3600).toString().padStart(2, '0');
    const mm = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
    const ss = (elapsed % 60).toString().padStart(2, '0');
    const timerStr = `${hh}:${mm}:${ss}`;
    const timerWarning = elapsed > 120;
    const timerAlert = elapsed > 240;

    const currentQ = questions[room.currentQuestionIdx];
    const myTeamData = room.teams[myTeam];
    const code = myTeamData.code || CPP_TEMPLATE;
    const knivesAvail = myTeamData.knivesUnlocked - myTeamData.knivesUsed;
    const canPlace = (room.phase === 'grid_pick' && room.lastSolvedBy === myTeam && myTeamData.pendingGridPicks > 0);
    // Knife can only be activated in battle phase (Q4+, idx >= 3)
    const canActivateKnife = knivesAvail > 0 && room.currentQuestionIdx >= 3 && room.phase === 'playing';

    // Handlers
    const handleCodeChange = (val: string | undefined) => {
        const newCode = val || '';
        setRoom(prev => ({
            ...prev,
            teams: {
                ...prev.teams,
                [myTeam]: { ...prev.teams[myTeam], code: newCode }
            }
        }));
        // Persist to localStorage so refresh doesn't lose code
        saveCode(room.code, room.currentQuestionIdx, myTeam, langChoice, newCode);
        send('player_typing', { isTyping: true });
    };

    // ── Run Code: runs against all sample TCs + custom, shows per-TC results ──
    const handleRun = async () => {
        if (runStatus === 'running') return;
        if (!code || !code.trim()) return;
        setRunStatus('running');
        setIoTab('result');
        setTcRuns([]);

        // Build inputs: sample TCs + custom (if filled)
        const toRun: { input: string; expected: string }[] = sampleTcs.map(tc => ({
            input: tc.input, expected: tc.expected_output,
        }));
        if (sampleTcs.length === 0 || customTcInput.trim()) {
            toRun.push({ input: customTcInput, expected: '' });
        }

        try {
            const promises = toRun.map(tc =>
                axios.post(`${import.meta.env.VITE_API_URL || ''}/api/compiler/run`, {
                    language: langChoice, code, input: tc.input,
                }).then(res => ({
                    output: res.data.output || '(No output)',
                    passed: res.data.status === 'success' && (
                        !tc.expected.trim() || res.data.output?.trim() === tc.expected.trim()
                    ),
                    expected: tc.expected,
                    time: res.data.time ?? null,
                })).catch((err: any) => ({
                    output: err.response?.data?.output || err.response?.data?.error || err.message || 'Execution Error',
                    passed: false,
                    expected: tc.expected,
                    time: null,
                }))
            );
            const results = await Promise.all(promises);
            setTcRuns(results);
            setActiveTcIdx(0);
            const maxTime = Math.max(...results.map(r => r.time ?? 0));
            setExecTime(maxTime > 0 ? maxTime : null);
            setRunStatus(results.every(r => r.passed) ? 'success' : 'error');
        } catch {
            setRunStatus('error');
        }
    };

    // ── Submit: compiles once, runs ALL test cases concurrently, fires game event on accept ──
    const handleSubmit = async () => {
        if (submitStatus === 'submitting') return;
        if (!currentQ?.id) { showToast('No question loaded', 'error'); return; }
        if (room.phase !== 'playing') { showToast('Game is not in playing phase.', 'error'); return; }
        // Capture question index at submit time to avoid stale closure
        const submittingQIdx = room.currentQuestionIdx;
        setSubmitStatus('submitting');
        setIoTab('submit');
        setSubmitOutput('⏳ Judging... running all test cases simultaneously...');
        setSubmitDetail(null);
        try {
            const res = await axios.post(`${import.meta.env.VITE_API_URL || ''}/api/compiler/submit`, {
                code,
                language: langChoice,
                problemId: currentQ.id,
                roomCode: room.code,
                teamId: myTeam,
            });
            const { verdict, testCasesPassed, totalTestCases, timeTaken, error: detail } = res.data;
            setExecTime(timeTaken ?? null);
            setSubmitDetail({ passed: testCasesPassed ?? 0, total: totalTestCases ?? 0, time: timeTaken ?? null });
            setSubmitOutput(detail || verdict);
            if (verdict === 'accepted') {
                setSubmitStatus('accepted');
                // Clear saved code for this question so next attempt starts fresh
                clearCode(room.code, submittingQIdx, myTeam, langChoice);
                // Notify the game server — triggers grid pick
                send('question_solved', { questionIdx: submittingQIdx });
                showToast(`✅ Accepted! ${testCasesPassed}/${totalTestCases} test cases passed`, 'success');
            } else {
                setSubmitStatus('rejected');
                const label = verdict.replace(/_/g, ' ').toUpperCase();
                showToast(`❌ ${label} — ${testCasesPassed ?? 0}/${totalTestCases ?? 0} passed`, 'error');
            }
        } catch (err: any) {
            setSubmitStatus('error');
            if (err.response?.status === 429) {
                setSubmitOutput('⚠️ Previous submission still running. Please wait a moment.');
                showToast('Submission already in progress', 'error');
            } else {
                setSubmitOutput(err.response?.data?.error || err.message || 'Server Error');
                showToast('Submission failed — server error', 'error');
            }
        }
    };

    const handleCellClick = (idx: number) => {
        if (knifeMode) {
            // Knife mode: attempt to strike any cell (server decides wasted vs hit)
            if (room.grid[idx] === myTeam) {
                showToast('You cannot knife your own cell!', 'error');
                return;
            }
            send('use_knife', { targetCellIdx: idx });
            setKnifeMode(false);
            return;
        }
        if (canPlace) {
            send('place_on_grid', { cellIdx: idx });
        }
    };

    return (
        <div className="game-pro-root">
            {showBattleIntro && (
                <BattleIntro
                    teamA={room.teams.A.name || 'Team A'}
                    teamB={room.teams.B.name || 'Team B'}
                    onDone={handleBattleDone}
                />
            )}
            {/* ── TOP NAV BAR ─────────────────────────────────── */}
            <header className="game-top-nav">
                <div className="nav-left">
                    <div className="pro-logo">
                        <Code2 size={24} className="logo-icon" color="#3b82f6" />
                        <span className="logo-text">CODE<span className="accent">ARENA</span></span>
                    </div>
                    <div className="team-badge-pill" style={{ borderColor: TEAM_COLORS[myTeam], background: TEAM_BG[myTeam], color: TEAM_COLORS[myTeam] }}>
                        <Swords size={14} />
                        <span>{state.teamName}</span>
                    </div>
                </div>

                <div className="nav-center">
                    {room.phase === 'playing' && room.questionStartedAt && (
                        <div className={`pro-timer-pill ${timerAlert ? 'alert' : timerWarning ? 'warn' : ''}`}>
                            <Clock size={15} className="timer-icon" />
                            <span className="timer-val">{timerStr}</span>
                        </div>
                    )}
                    {room.phase === 'grid_pick' && room.lastSolvedBy === myTeam && (
                        <div className="pro-status-pill action">
                            <Zap size={14} /> <span>YOUR TURN: PICK {myTeamData.pendingGridPicks} CELL(S)</span>
                        </div>
                    )}
                </div>

                <div className="nav-right">
                    <div className="nav-actions">
                        <button
                            className={`nav-btn-run ${runStatus === 'running' ? 'loading' : ''}`}
                            onClick={handleRun}
                            disabled={runStatus === 'running' || submitStatus === 'submitting'}
                        >
                            {runStatus === 'running' ? <Loader2 size={15} className="spinning" /> : <Play size={15} />}
                            <span>Run</span>
                        </button>
                        <button
                            className={`nav-btn-submit ${
                                submitStatus === 'submitting' ? 'loading' :
                                submitStatus === 'accepted' ? 'accepted' :
                                submitStatus === 'rejected' ? 'rejected' : ''
                            }`}
                            onClick={handleSubmit}
                            disabled={submitStatus === 'submitting' || runStatus === 'running'}
                        >
                            {submitStatus === 'submitting'
                                ? <Loader2 size={15} className="spinning" />
                                : submitStatus === 'accepted'
                                    ? <Trophy size={15} />
                                    : <UploadCloud size={15} />}
                            <span>Submit</span>
                        </button>
                    </div>
                </div>
            </header>

            <main className="game-pro-content">
                {/* ── LEFT PANEL: PROBLEM ── */}
                <div className={`panel-left-wrapper ${problemOpen ? 'open' : 'closed'}`}>
                <aside className="pro-panel-left">
                    <div className="panel-tabs">
                        <button className="p-tab active">Challenge</button>
                        <button className="panel-close-btn" onClick={() => setProblemOpen(false)} title="Collapse panel">✕</button>
                    </div>
                    <div className="panel-scroll-area">
                        {currentQ ? (
                            <div className="q-content">
                                <div className="q-head">
                                    <h1 className="q-title">{currentQ.title}</h1>
                                    <div className="q-meta">
                                        <span className={`q-diff ${currentQ.difficulty?.toLowerCase()}`}>{currentQ.difficulty}</span>
                                        <span className="q-type">{room.currentQuestionIdx < 3 ? 'Knife Phase' : 'Battle Phase'}</span>
                                    </div>
                                </div>
                                <div className="q-body" dangerouslySetInnerHTML={{ __html: currentQ.description?.replace(/\n/g, '<br/>') }} />

                                <div className="q-section">
                                    <h3>Input Format</h3>
                                    <pre className="q-io-box">{currentQ.input_format || "No special input format."}</pre>
                                </div>
                                <div className="q-section">
                                    <h3>Expected Output</h3>
                                    <pre className="q-io-box expected">{currentQ.output_format || "Follow standard output format."}</pre>
                                </div>
                                {currentQ.constraints && (
                                    <div className="q-section">
                                        <h3>Constraints</h3>
                                        <pre className="q-io-box">{currentQ.constraints}</pre>
                                    </div>
                                )}
                                {/* ── Hints ── */}
                                <div className="q-section q-hints-section">
                                    <h3 className="q-hints-header">
                                        <span>💡 Hints</span>
                                        {hints.length > 0 && (
                                            <span className="hint-count-badge">{hints.length}</span>
                                        )}
                                    </h3>
                                    {hints.length === 0 ? (
                                        <div className="no-hints-msg">No hints needed for this problem</div>
                                    ) : (
                                        <div className="hints-list">
                                            {hints.map((hint, i) => (
                                                <div key={hint.id} className="hint-item">
                                                    <button
                                                        className={`hint-reveal-btn ${revealedHints.has(i) ? 'opened' : ''}`}
                                                        onClick={() => toggleHint(i)}
                                                    >
                                                        <span className="hint-chevron">{revealedHints.has(i) ? '▼' : '▶'}</span>
                                                        <span>Hint {i + 1}</span>
                                                    </button>
                                                    {revealedHints.has(i) && (
                                                        <div className="hint-content">{hint.content}</div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="q-loading">
                                {questionsError ? (
                                    <>
                                        <div style={{ marginBottom: '10px', color: '#e55' }}>Failed to load challenge</div>
                                        <button
                                            onClick={loadQuestions}
                                            style={{
                                                padding: '6px 16px', borderRadius: '6px',
                                                background: '#2563eb', color: '#fff',
                                                border: 'none', cursor: 'pointer', fontSize: '13px'
                                            }}
                                        >↻ Retry</button>
                                    </>
                                ) : 'Loading Challenge...'}
                            </div>
                        )}
                    </div>
                </aside>
                <button
                    className="panel-toggle-tab"
                    onClick={() => setProblemOpen(v => !v)}
                    title={problemOpen ? 'Collapse panel' : 'Expand panel'}
                >
                    <ChevronLeft size={13} className={problemOpen ? '' : 'flipped'} />
                </button>
                </div>

                {/* ── CENTER PANEL: EDITOR ── */}
                <section className={`pro-panel-center ${editorFullscreen ? 'editor-fullscreen' : ''}`}>
                    <div className="editor-wrapper">
                        <div className="editor-header">
                            <div className="ed-lang">
                                <div className="ed-file-tab">
                                    <FileCode size={14} className="ed-file-icon" />
                                    <span className="ed-file-name">
                                        {langChoice === 'cpp' ? 'solution.cpp' : 'solution.c'}
                                    </span>
                                    <div className="ed-dot active" />
                                </div>
                            </div>
                            <div className="ed-header-right">
                                <select
                                    className="ed-lang-select"
                                    value={langChoice}
                                    onChange={e => setLangChoice(e.target.value as 'cpp' | 'c')}
                                    title="Switch language"
                                >
                                    <option value="cpp">C++ 17</option>
                                    <option value="c">C 11</option>
                                </select>
                                {execTime !== null && (
                                    <div className="ed-stat">
                                        <Zap size={12} />
                                        {execTime}ms
                                    </div>
                                )}
                                <button
                                    className="ed-fullscreen-btn"
                                    onClick={() => setEditorFullscreen(v => !v)}
                                    title={editorFullscreen ? 'Exit fullscreen' : 'Fullscreen editor'}
                                >
                                    {editorFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                                </button>
                            </div>
                        </div>
                        <div className="ed-main" style={{ flex: 1 }}>
                            <Editor
                                height="100%"
                                language={langChoice}
                                theme="codepie-light"
                                value={code}
                                onChange={handleCodeChange}
                                beforeMount={handleEditorBeforeMount}
                                onMount={(editor) => {
                                    editor.onKeyDown((e: any) => {
                                        // Block Ctrl+V / Cmd+V (paste)
                                        if ((e.ctrlKey || e.metaKey) && e.keyCode === 86) {
                                            e.preventDefault();
                                            e.stopPropagation();
                                        }
                                        // Block Ctrl+C / Cmd+C (copy)
                                        if ((e.ctrlKey || e.metaKey) && e.keyCode === 67) {
                                            e.preventDefault();
                                            e.stopPropagation();
                                        }
                                    });
                                }}
                                options={{
                                    minimap: { enabled: false },
                                    fontSize: 15,
                                    fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
                                    fontLigatures: true,
                                    scrollBeyondLastLine: false,
                                    padding: { top: 16, bottom: 16 },
                                    // IntelliSense
                                    quickSuggestions: { other: true, comments: false, strings: false },
                                    suggestOnTriggerCharacters: true,
                                    acceptSuggestionOnEnter: 'on',
                                    tabCompletion: 'on',
                                    snippetSuggestions: 'inline',
                                    wordBasedSuggestions: 'currentDocument',
                                    parameterHints: { enabled: true },
                                    // Editor feel
                                    cursorBlinking: 'phase',
                                    cursorSmoothCaretAnimation: 'on',
                                    smoothScrolling: true,
                                    bracketPairColorization: { enabled: true },
                                    autoClosingBrackets: 'always',
                                    autoClosingQuotes: 'always',
                                    formatOnPaste: true,
                                    lineNumbers: 'on',
                                    renderLineHighlight: 'all',
                                    overviewRulerBorder: false,
                                    scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
                                }}
                            />
                        </div>
                    </div>

                    <div className="io-wrapper">
                        {/* ── LeetCode-style 3-tab IO panel ── */}
                        <div className="io-tabs">
                            <button
                                className={`io-tab ${ioTab === 'testcase' ? 'active' : ''}`}
                                onClick={() => setIoTab('testcase')}
                            >Testcase</button>
                            <button
                                className={`io-tab ${ioTab === 'result' ? 'active' : ''} ${
                                    ioTab !== 'result' && tcRuns.length > 0
                                        ? tcRuns.every(r => r.passed) ? 'tab-pass' : 'tab-fail'
                                        : ''
                                }`}
                                onClick={() => setIoTab('result')}
                            >
                                Test Result
                                {tcRuns.length > 0 && (
                                    <span className={`io-tab-badge ${tcRuns.every(r => r.passed) ? 'badge-pass' : 'badge-fail'}`}>
                                        {tcRuns.filter(r => r.passed).length}/{tcRuns.length}
                                    </span>
                                )}
                            </button>
                            <button
                                className={`io-tab ${ioTab === 'submit' ? 'active' : ''} ${
                                    submitStatus === 'accepted' ? 'tab-accepted' :
                                    submitStatus === 'rejected' ? 'tab-rejected' : ''
                                }`}
                                onClick={() => setIoTab('submit')}
                            >
                                Submit
                                {submitDetail && (
                                    <span className={`io-tab-badge ${submitStatus === 'accepted' ? 'badge-pass' : 'badge-fail'}`}>
                                        {submitDetail.passed}/{submitDetail.total}
                                    </span>
                                )}
                            </button>
                        </div>
                        <div className="io-content">
                            {/* ── TESTCASE TAB ── */}
                            {ioTab === 'testcase' && (
                                <div className="tc-panel">
                                    <div className="tc-pills-row">
                                        {sampleTcs.map((_, i) => (
                                            <button
                                                key={i}
                                                className={`tc-pill ${activeTcIdx === i ? 'active' : ''}`}
                                                onClick={() => setActiveTcIdx(i)}
                                            >Case {i + 1}</button>
                                        ))}
                                        <button
                                            className={`tc-pill custom ${activeTcIdx === sampleTcs.length ? 'active' : ''}`}
                                            onClick={() => setActiveTcIdx(sampleTcs.length)}
                                        >+ Custom</button>
                                    </div>
                                    {activeTcIdx < sampleTcs.length ? (
                                        <div className="tc-boxes-row">
                                            <div className="tc-box">
                                                <div className="tc-box-label">Input</div>
                                                <pre className="tc-box-pre">{sampleTcs[activeTcIdx]?.input || '(empty)'}</pre>
                                            </div>
                                            <div className="tc-box">
                                                <div className="tc-box-label">Expected Output</div>
                                                <pre className="tc-box-pre">{sampleTcs[activeTcIdx]?.expected_output || '(empty)'}</pre>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="tc-boxes-row">
                                            <div className="tc-box" style={{ flex: 1 }}>
                                                <div className="tc-box-label">Custom stdin</div>
                                                <textarea
                                                    className="pro-textarea"
                                                    placeholder="Enter custom input..."
                                                    value={customTcInput}
                                                    onChange={e => setCustomTcInput(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── RESULT TAB ── */}
                            {ioTab === 'result' && (
                                <div className="tc-panel">
                                    {tcRuns.length === 0 ? (
                                        <div className="tc-empty">
                                            {runStatus === 'running' ? <><Loader2 size={16} className="spinning" /> Running test cases...</> : 'Click Run to see results'}
                                        </div>
                                    ) : (<>
                                        <div className="tc-pills-row">
                                            {tcRuns.map((r, i) => (
                                                <button
                                                    key={i}
                                                    className={`tc-pill ${activeTcIdx === i ? 'active' : ''} ${r.passed ? 'pass' : 'fail'}`}
                                                    onClick={() => setActiveTcIdx(i)}
                                                >
                                                    {r.passed ? '✓' : '✕'} {i < sampleTcs.length ? `Case ${i + 1}` : 'Custom'}
                                                </button>
                                            ))}
                                        </div>
                                        {tcRuns[activeTcIdx] && (
                                            <div className="tc-boxes-row">
                                                <div className="tc-box">
                                                    <div className="tc-box-label">Your Output</div>
                                                    <pre className={`tc-box-pre ${tcRuns[activeTcIdx].passed ? 'pass' : 'fail'}`}>
                                                        {tcRuns[activeTcIdx].output}
                                                    </pre>
                                                </div>
                                                {tcRuns[activeTcIdx].expected && (
                                                    <div className="tc-box">
                                                        <div className="tc-box-label">Expected</div>
                                                        <pre className="tc-box-pre expected">{tcRuns[activeTcIdx].expected}</pre>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {tcRuns[activeTcIdx]?.time != null && (
                                            <div className="tc-time-row">{tcRuns[activeTcIdx].time}ms</div>
                                        )}
                                    </>)}
                                </div>
                            )}

                            {/* ── SUBMIT TAB ── */}
                            {ioTab === 'submit' && (
                                <div className="submit-result-pane">
                                    <div className={`submit-verdict-banner ${
                                        submitStatus === 'accepted' ? 'accepted' :
                                        submitStatus === 'rejected' ? 'rejected' :
                                        submitStatus === 'submitting' ? 'judging' : ''
                                    }`}>
                                        {submitStatus === 'submitting' && <><Loader2 size={14} className="spinning" /> Judging all test cases simultaneously...</>}
                                        {submitStatus === 'accepted' && <><Trophy size={14} /> ACCEPTED — {submitDetail?.passed}/{submitDetail?.total} passed{submitDetail?.time ? ` · ${submitDetail.time}ms` : ''}</>}
                                        {submitStatus === 'rejected' && <>❌ {submitDetail?.passed}/{submitDetail?.total} test cases passed</>}
                                        {submitStatus === 'error' && <>⚠️ Submission Error</>}
                                        {submitStatus === 'idle' && <>Click Submit to judge against all test cases</>}
                                    </div>
                                    <div className={`pro-output-box submit-out ${
                                        submitStatus === 'accepted' ? 'success' :
                                        submitStatus === 'rejected' || submitStatus === 'error' ? 'error' : ''
                                    }`}>
                                        <pre style={{ margin: 0 }}>{submitOutput || 'Press Submit to run against all hidden test cases.'}</pre>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                {/* ── RIGHT PANEL: BATTLE ── */}
                <aside className="pro-panel-right">
                    <div className="battle-card">

                        {/* Header */}
                        <div className="bc-header">
                            <Swords size={16} color="#3b82f6" />
                            <span className="bc-title">LIVE ARENA</span>
                            <div className="bc-room">{room.code}</div>
                        </div>

                        {/* Question progress bar */}
                        <div className="bc-progress">
                            <div className="bc-prog-label">
                                <span>Q {room.currentQuestionIdx + 1} / {room.questionCount}</span>
                                <span className={`bc-phase-badge ${room.phase}`}>
                                    {room.phase === 'playing' ? '● LIVE' : room.phase === 'grid_pick' ? '⊞ PICK' : room.phase === 'ended' ? '■ ENDED' : '● WAITING'}
                                </span>
                            </div>
                            <div className="bc-prog-track">
                                <div className="bc-prog-fill" style={{ width: `${((room.currentQuestionIdx) / room.questionCount) * 100}%` }} />
                            </div>
                        </div>

                        {/* Leaderboard */}
                        <div className="bc-leaderboard">
                            {/* Team A */}
                            <div className={`bc-lb-team ${myTeam === 'A' ? 'mine' : ''}`} style={{ '--tc': TEAM_COLORS.A } as React.CSSProperties}>
                                <div className="bc-lb-avatar">{room.teams.A.name?.charAt(0).toUpperCase() || 'A'}</div>
                                <div className="bc-lb-info">
                                    <div className="bc-lb-name">{room.teams.A.name || 'Team A'}</div>
                                    <div className="bc-lb-solved">{room.teams.A.solved.length} solved</div>
                                </div>
                                <div className="bc-lb-count">{room.teams.A.solved.length}</div>
                            </div>
                            <div className="bc-lb-divider">VS</div>
                            {/* Team B */}
                            <div className={`bc-lb-team ${myTeam === 'B' ? 'mine' : ''}`} style={{ '--tc': TEAM_COLORS.B } as React.CSSProperties}>
                                <div className="bc-lb-count">{room.teams.B.solved.length}</div>
                                <div className="bc-lb-info" style={{ textAlign: 'right' }}>
                                    <div className="bc-lb-name">{room.teams.B.name || 'Team B'}</div>
                                    <div className="bc-lb-solved">{room.teams.B.solved.length} solved</div>
                                </div>
                                <div className="bc-lb-avatar b">{room.teams.B.name?.charAt(0).toUpperCase() || 'B'}</div>
                            </div>
                        </div>

                        {/* 3×3 grid */}
                        <div className={`pro-ttt-grid ${canPlace ? 'picking' : ''} ${knifeMode ? 'knife-mode' : ''}`}>
                            {room.grid.map((cell, idx) => {
                                const isOpponent = cell === (myTeam === 'A' ? 'B' : 'A');
                                return (
                                    <div
                                        key={idx}
                                        className={`pro-ttt-cell
                                            ${cell ? 'filled-' + cell : ''}
                                            ${canPlace && !cell ? 'active' : ''}
                                            ${knifeMode && isOpponent ? 'knife-hit' : ''}
                                            ${knifeMode && !cell ? 'knife-empty' : ''}
                                            ${knifeMode && cell === myTeam ? 'knife-own' : ''}
                                        `.trim().replace(/\s+/g, ' ')}
                                        onClick={() => handleCellClick(idx)}
                                    >
                                        {cell === 'A' && <span className="m-a">✕</span>}
                                        {cell === 'B' && <span className="m-b">○</span>}
                                        {!cell && canPlace && <span className="m-ghost">{myTeam === 'A' ? '✕' : '○'}</span>}
                                        {knifeMode && isOpponent && <span className="m-knife-target"><Scissors size={14} /></span>}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Knives — 3 given at game start, usable only in Battle Phase (Q4+) */}
                        <div className={`bc-knives ${knifeMode ? 'knife-active-mode' : ''}`}>
                            <div className="bck-top-row">
                                <span className="bck-label">KNIVES</span>
                                <span className="bck-uses-left">{knivesAvail}/3</span>
                            </div>
                            <div className="bck-icons">
                                {Array.from({ length: 3 }).map((_, i) => {
                                    const isUsed = i < myTeamData.knivesUsed;
                                    const isSelected = !isUsed && knifeMode;
                                    return (
                                        <button
                                            key={i}
                                            className={`bck-icon-btn ${isUsed ? 'used' : 'avail'} ${isSelected ? 'selected' : ''}`}
                                            disabled={isUsed}
                                            title={isUsed ? 'Knife already used' : canActivateKnife ? 'Click to activate knife mode' : room.currentQuestionIdx < 3 ? 'Knives unlock in Battle Phase (Q4+)' : 'No knives left'}
                                            onClick={() => {
                                                if (isUsed) return;
                                                if (!canActivateKnife) {
                                                    if (knivesAvail > 0 && room.currentQuestionIdx < 3) {
                                                        showToast('Save your knives! They can only be used in the Battle Phase (Q4–Q6).', 'warning');
                                                    }
                                                    return;
                                                }
                                                setKnifeMode(prev => !prev);
                                            }}
                                        >
                                            <Scissors size={14} />
                                        </button>
                                    );
                                })}
                            </div>
                            {knifeMode ? (
                                <div className="bck-mode-hint">
                                    <span>Select opponent cell to strike</span>
                                    <button className="bck-cancel-btn" onClick={() => setKnifeMode(false)}>Cancel</button>
                                </div>
                            ) : (
                                room.currentQuestionIdx < 3 && knivesAvail > 0 && (
                                    <div className="bck-phase-note">Available from Q4 (Battle Phase)</div>
                                )
                            )}
                        </div>


                    </div>
                </aside>
            </main>

            {/* Overlays */}
            {toast && <div className={`pro-toast ${toast.type}`}> {toast.msg} </div>}

            {room.phase === 'ended' && (
                <div className="pro-end-overlay">
                    <div className="pro-end-card">
                        <Trophy size={80} color="#ffaa00" style={{ marginBottom: '20px' }} />
                        <h1 className="end-title">
                            {room.winner === 'tie' ? "DRAW" :
                                room.winner === myTeam ? "VICTORY" : "DEFEAT"}
                        </h1>
                        <div className="end-scores">
                            <div className="es-team"><span style={{ color: TEAM_COLORS.A }}>{room.teams.A.name}</span> <strong>{room.teams.A.solved.length} solved</strong></div>
                            <div className="es-team"><span style={{ color: TEAM_COLORS.B }}>{room.teams.B.name}</span> <strong>{room.teams.B.solved.length} solved</strong></div>
                        </div>
                        <button className="nav-btn-run" onClick={() => navigate('/')}>Exit Arena</button>
                    </div>
                </div>
            )}


        </div>
    );
}
