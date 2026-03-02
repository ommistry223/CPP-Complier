import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import axios from 'axios';
import { Play, Loader2, Code2, Terminal } from 'lucide-react';
import './Compiler.css';

const DEFAULT_CODE: Record<string, string> = {
    cpp: `#include <iostream>\nusing namespace std;\n\nint main() {\n    // Read input\n    // string name;\n    // if (cin >> name) cout << "Hello " << name << endl;\n    cout << "Hello World!" << endl;\n    return 0;\n}\n`
};

const Compiler = () => {
    const [language, setLanguage] = useState('cpp');
    const [code, setCode] = useState(DEFAULT_CODE['cpp']);
    const [input, setInput] = useState('');
    const [output, setOutput] = useState('');
    const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
    const [time, setTime] = useState<number | null>(null);
    const [loadTestCount, setLoadTestCount] = useState<number>(1);
    const [averageTime, setAverageTime] = useState<number | null>(null);
    const [questions, setQuestions] = useState<any[]>([]);
    const [currentIdx, setCurrentIdx] = useState(0);
    const [questionDesc, setQuestionDesc] = useState('');
    const [apiError, setApiError] = useState<string | null>(null);
    // Fetch questions from backend on mount
    useEffect(() => {
        axios.get('/api/problems?published=true')
            .then(res => {
                console.log('API response:', res.data);
                setQuestions(res.data.problems || []);
                setApiError(null);
                if (res.data.problems && res.data.problems.length > 0) {
                    setQuestionDesc(res.data.problems[0].description);
                    setCode(DEFAULT_CODE['cpp']);
                }
            })
            .catch(err => {
                setApiError(err?.response?.data?.message || err.message || 'Failed to fetch questions');
            });
    }, []);

    // Update question description when currentIdx changes
    useEffect(() => {
        if (questions.length > 0 && questions[currentIdx]) {
            setQuestionDesc(questions[currentIdx].description);
            setInput('');
            setOutput('');
            setStatus('idle');
            setTime(null);
            setAverageTime(null);
            setCode(DEFAULT_CODE['cpp']);
        }
    }, [currentIdx, questions]);

    const handleLanguageChange = (e: any) => {
        const lang = e.target.value;
        setLanguage(lang);
        setCode(DEFAULT_CODE[lang] || '');
        setOutput('');
        setStatus('idle');
        setTime(null);
        setAverageTime(null);
    };

    const handleRunCode = async () => {
        setStatus('running');
        setOutput(loadTestCount > 1 ? `Executing code ${loadTestCount} times asynchronously...\nWait for backend response.` : 'Executing code...\nWait for backend response.');
        setTime(null);
        setAverageTime(null);

        try {
            if (loadTestCount <= 1) {
                // Single Run
                const res = await axios.post('/api/compiler/run', {
                    language,
                    code,
                    input
                });

                if (res.data.status === 'success') {
                    setStatus('success');
                    setOutput(res.data.output || '(No Output)');
                    setTime(res.data.time);
                    // If solved, go to next question
                    if (questions.length > 0 && currentIdx < questions.length - 1) {
                        setTimeout(() => setCurrentIdx(currentIdx + 1), 1200);
                    }
                } else {
                    setStatus('error');
                    setOutput(res.data.output || 'Unknown Error Occurred');
                    setTime(res.data.time);
                }
            } else {
                // Load Test Mode
                const globalStartTime = Date.now();
                const promises = [];

                for (let i = 0; i < loadTestCount; i++) {
                    promises.push(axios.post('/api/compiler/run', {
                        language,
                        code,
                        input
                    }));
                }

                const results = await Promise.all(promises);
                const globalEndTime = Date.now();

                // Calculate average execution time returned by backend
                let totalBackendTime = 0;
                let errorOccurred = false;
                let sampleOutput = "";

                results.forEach((res) => {
                    if (res.data.status === 'success') {
                        totalBackendTime += res.data.time || 0;
                        sampleOutput = res.data.output;
                    } else {
                        errorOccurred = true;
                        sampleOutput = res.data.output;
                    }
                });

                if (!errorOccurred) {
                    setStatus('success');
                    setOutput(`[LOAD TEST COMPLETED HITTING SAME EXPRESS ENDPOINT]\n\nAll ${loadTestCount} requests routed through Redis Bull Queue successfully.\nSample Output:\n\n${sampleOutput || '(No Output)'}`);
                    setTime(globalEndTime - globalStartTime); // Total JS Execution Time for all promises
                    setAverageTime(Math.round(totalBackendTime / loadTestCount));
                } else {
                    setStatus('error');
                    setOutput(`[LOAD TEST ENCOUNTERED ERRORS]\nOne or more concurrent queries failed.\n\nSample Error:\n${sampleOutput}`);
                }
            }
        } catch (err: any) {
            console.error(err);
            setStatus('error');
            setOutput(err.response?.data?.error || err.message || 'System Error');
        }
    };

    return (
        <div className="compiler-view">
            {/* Left Panel - Editor */}
            <div className="panel editor-panel glass-panel" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Code2 size={20} color="var(--neon-cyan)" />
                        <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Code Editor</h2>
                    </div>

                    <div className="editor-actions" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <select
                            className="language-select input-base"
                            value={language}
                            onChange={handleLanguageChange}
                            style={{ padding: '6px 12px', width: 'auto' }}
                        >
                            <option value="cpp">C++ (G++)</option>
                        </select>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '4px 12px', borderRadius: '4px' }}>
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Load Test (Concurrent):</span>
                            <input
                                type="number"
                                className="input-base"
                                value={loadTestCount}
                                onChange={(e) => setLoadTestCount(Math.max(1, parseInt(e.target.value) || 1))}
                                min={1}
                                max={100}
                                style={{ width: '60px', padding: '4px 8px', textAlign: 'center' }}
                            />
                        </div>
                        <button
                            className="btn btn-primary"
                            onClick={handleRunCode}
                            disabled={status === 'running'}
                            style={{ padding: '8px 24px' }}
                        >
                            {status === 'running' ? <Loader2 size={16} className="spinning" /> : <Play size={16} />}
                            <span style={{ marginLeft: '8px' }}>Run Code</span>
                        </button>
                    </div>
                </div>

                {/* Monaco Editor fills remaining height */}
                <div className="monaco-wrapper">
                    <Editor
                        height="100%"
                        language={language}
                        theme="vs-dark"
                        value={code}
                        onChange={(val) => setCode(val || '')}
                        options={{
                            minimap: { enabled: false },
                            fontSize: 15,
                            fontFamily: "JetBrains Mono, monospace",
                            scrollBeyondLastLine: false,
                            padding: { top: 16 }
                        }}
                    />
                </div>
            </div>

            {/* Right Panel - Info & Input / Output */}
            <div className="panel io-panel">
                {/* Problem Description Section */}
                <div className="description-section glass-panel">
                    <div className="description-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Code2 size={20} color="var(--neon-cyan)" />
                            <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-heading)' }}>
                                {questions[currentIdx]?.title || 'Problem Description'}
                            </h3>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                className="btn btn-nav"
                                disabled={currentIdx === 0}
                                onClick={() => setCurrentIdx(currentIdx - 1)}
                            >
                                Previous
                            </button>
                            <button
                                className="btn btn-nav"
                                disabled={currentIdx === questions.length - 1}
                                onClick={() => setCurrentIdx(currentIdx + 1)}
                            >
                                Next
                            </button>
                        </div>
                    </div>

                    <div className="description-scroll">
                        {apiError ? (
                            <div style={{ color: 'var(--accent-error)' }}>{apiError}</div>
                        ) : questions.length === 0 ? (
                            <div style={{ color: 'var(--neon-cyan)' }}>Loading problem details...</div>
                        ) : (
                            <div dangerouslySetInnerHTML={{ __html: questionDesc.replace(/\n/g, '<br/>') }} />
                        )}
                    </div>
                </div>

                {/* Expected Output (Sample) */}
                <div className="io-box glass-panel compact-io">
                    <div className="io-container">
                        <div className="io-label">
                            <Terminal size={14} />
                            <span>Expected Output (Sample)</span>
                        </div>
                        <div className="io-output expected-output">
                            {questions[currentIdx]?.output_format || 'Check description for sample output'}
                        </div>
                    </div>
                </div>

                {/* Custom Input */}
                <div className="io-box glass-panel compact-io">
                    <div className="io-container">
                        <div className="io-label">
                            <Terminal size={14} />
                            <span>Custom Input (stdin)</span>
                        </div>
                        <textarea
                            className="io-textarea"
                            placeholder="Type input for your code..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            spellCheck={false}
                        ></textarea>
                    </div>
                </div>

                {/* Actual Output */}
                <div className="io-box glass-panel compact-io">
                    <div className="io-container">
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 0 8px 0', alignItems: 'center' }}>
                            <div className="io-label" style={{ margin: 0 }}>
                                <Terminal size={14} />
                                <span>Actual Output (stdout)</span>
                            </div>
                            {time !== null && (
                                <div style={{ display: 'flex' }}>
                                    {averageTime !== null && (
                                        <div style={{ fontSize: '0.75rem', color: 'var(--neon-purple)', marginRight: '8px' }}>
                                            Avg: {averageTime} ms
                                        </div>
                                    )}
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        {time} ms
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className={`io-output ${status === 'error' ? 'error' : ''}`} style={{ margin: '0 10px 10px 10px' }}>
                        {output ? (
                            <pre style={{ margin: 0 }}>{output}</pre>
                        ) : (
                            <div className="text-muted" style={{ fontSize: '0.85rem' }}>Run code to see output</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Compiler;
