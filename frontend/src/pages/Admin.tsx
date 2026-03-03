import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameSocket } from '../hooks/useGameSocket';
import { Settings, Swords, Users, Play, Copy, Check, RefreshCw, Database, Heart, Plus, Trash2, ChevronDown, ChevronUp, Activity, Trophy, Download, Lightbulb } from 'lucide-react';
import axios from 'axios';
import './Admin.css';

interface RoomCodes { roomCode: string; adminCode: string; teamACode: string; teamBCode: string; }
interface RoomState { phase: string; teams: { A: { name: string | null }; B: { name: string | null } }; questionCount: number; winner: string | null; }
interface TestCase { id: string; input: string; expected_output: string; is_sample: boolean; order_index: number; }
interface Problem { id: string; title: string; difficulty: string; is_published: boolean; }
interface TournamentPair { pairNo: number; roomCode: string; teamACode: string; teamBCode: string; }
interface TournamentResult { tournamentId: string; name: string; pairs: TournamentPair[]; }
interface HintItem { id: string; content: string; order_index: number; }

export default function Admin() {
    const navigate = useNavigate();
    const [adminTab, setAdminTab] = useState<'game' | 'tournament' | 'problems' | 'health'>('game');

    // ── Game state ──────────────────────────────────────────
    const [questionCount, setQuestionCount] = useState(17);
    const [codes, setCodes] = useState<RoomCodes | null>(null);
    const [room, setRoom] = useState<RoomState | null>(null);
    const [creating, setCreating] = useState(false);
    const [starting, setStarting] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState<string | null>(null);
    const [adminInput, setAdminInput] = useState('');
    const lastSyncedRef = useRef<string | null>(null);

    // ── Problem Manager state ──────────────────────────────
    const [problems, setProblems] = useState<Problem[]>([]);
    const [problemsLoading, setProblemsLoading] = useState(false);
    const [expandedProblem, setExpandedProblem] = useState<string | null>(null);
    const [problemTcs, setProblemTcs] = useState<Record<string, TestCase[]>>({});
    const [newTc, setNewTc] = useState<Record<string, { input: string; expected_output: string; is_sample: boolean }>>({});
    const [tcSaving, setTcSaving] = useState<string | null>(null);
    const [tcDeleting, setTcDeleting] = useState<string | null>(null);    // Hints per problem
    const [problemHints, setProblemHints] = useState<Record<string, HintItem[]>>({});
    const [newHintText, setNewHintText] = useState<Record<string, string>>({});
    const [hintSaving, setHintSaving] = useState<string | null>(null);
    const [hintDeleting, setHintDeleting] = useState<string | null>(null);

    // ── Tournament state ─────────────────────────────────
    const [tPairs, setTPairs] = useState(4);
    const [tQCount, setTQCount] = useState(17);
    const [tName, setTName] = useState('');
    const [tCreating, setTCreating] = useState(false);
    const [tResult, setTResult] = useState<TournamentResult | null>(null);
    const [tError, setTError] = useState('');
    const [tCopied, setTCopied] = useState<string | null>(null);
    const [tStarting, setTStarting] = useState(false);
    const [tCountdown, setTCountdown] = useState<number | null>(null);
    const tCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // ── Health state ───────────────────────────────────────
    const [health, setHealth] = useState<any>(null);
    const [healthLoading, setHealthLoading] = useState(false);
    const [healthError, setHealthError] = useState('');
    const [dbStats, setDbStats] = useState<{ problems: number; testcases: number } | null>(null);

    const { send, connected } = useGameSocket(useCallback((msg) => {
        if (msg.type === 'admin_room_created') {
            const newCodes = { roomCode: msg.roomCode, adminCode: msg.adminCode, teamACode: msg.teamACode, teamBCode: msg.teamBCode };
            setCodes(newCodes);
            localStorage.setItem('arena_admin_code', msg.adminCode);
            setRoom(msg.room);
            setCreating(false);
        }
        if (msg.type === 'room_updated' || msg.type === 'admin_room_state') {
            setRoom(msg.room);
            if (msg.codes) { setCodes(msg.codes); localStorage.setItem('arena_admin_code', msg.codes.adminCode); }
            setRestoring(false);
        }
        if (msg.type === 'game_started') { setRoom(msg.room); setStarting(false); }
        if (msg.type === 'error') { setError(msg.message); setCreating(false); setStarting(false); setRestoring(false); }
    }, []));

    useEffect(() => {
        if (connected) {
            setError('');
            const savedAdminCode = localStorage.getItem('arena_admin_code');
            const targetCode = codes?.adminCode || savedAdminCode;
            if (targetCode && lastSyncedRef.current !== targetCode) {
                setRestoring(true);
                send('admin_watch', { adminCode: targetCode });
                lastSyncedRef.current = targetCode;
            }
            const p = setInterval(() => send('ping'), 15000);
            return () => clearInterval(p);
        } else { lastSyncedRef.current = null; }
    }, [connected, send, codes]);

    // ── Game handlers ──────────────────────────────────────
    const handleCreate = () => {
        setCreating(true); setError(''); setCodes(null); setRoom(null);
        send('admin_create_room', { questionCount });
        setTimeout(() => { setCreating(prev => { if (prev) setError('Room creation slow. Refresh if stuck.'); return false; }); }, 7000);
    };
    const handleStart = () => {
        const adminCode = codes?.adminCode || localStorage.getItem('arena_admin_code');
        if (!adminCode) { setError('Admin code lost.'); return; }
        setStarting(true); setError(''); send('admin_start_game', { adminCode });
    };
    const handleRestore = () => {
        if (!adminInput.trim()) return;
        setError(''); setRestoring(true); send('admin_watch', { adminCode: adminInput.trim() });
    };
    const copyToClipboard = async (text: string, key: string) => {
        await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(null), 2000);
    };

    // ── Problem Manager handlers ───────────────────────────
    const loadProblems = async () => {
        setProblemsLoading(true);
        try {
            const res = await axios.get('/api/problems');
            setProblems(res.data.problems || []);
        } catch { setProblems([]); }
        setProblemsLoading(false);
    };
    useEffect(() => { if (adminTab === 'problems') loadProblems(); }, [adminTab]);

    const toggleProblem = async (id: string) => {
        if (expandedProblem === id) { setExpandedProblem(null); return; }
        setExpandedProblem(id);
        if (!problemTcs[id]) {
            try {
                const res = await axios.get(`/api/problems/${id}/testcases/all`);
                setProblemTcs(prev => ({ ...prev, [id]: res.data.testcases || [] }));
            } catch { setProblemTcs(prev => ({ ...prev, [id]: [] })); }
        }
        if (!problemHints[id]) {
            try {
                const res = await axios.get(`/api/problems/${id}/hints`);
                setProblemHints(prev => ({ ...prev, [id]: res.data.hints || [] }));
            } catch { setProblemHints(prev => ({ ...prev, [id]: [] })); }
        }
        setNewTc(prev => ({ ...prev, [id]: prev[id] || { input: '', expected_output: '', is_sample: true } }));
        setNewHintText(prev => ({ ...prev, [id]: prev[id] || '' }));
    };

    const saveTestCase = async (problemId: string) => {
        const tc = newTc[problemId];
        if (!tc?.input.trim() || tc?.expected_output.trim() === undefined) return;
        setTcSaving(problemId);
        try {
            await axios.post(`/api/problems/${problemId}/testcases`, tc);
            const res = await axios.get(`/api/problems/${problemId}/testcases/all`);
            setProblemTcs(prev => ({ ...prev, [problemId]: res.data.testcases || [] }));
            setNewTc(prev => ({ ...prev, [problemId]: { input: '', expected_output: '', is_sample: true } }));
        } catch (e: any) { alert(e.response?.data?.message || 'Failed to save'); }
        setTcSaving(null);
    };

    const deleteTestCase = async (problemId: string, tcId: string) => {
        if (!confirm('Delete this test case?')) return;
        setTcDeleting(tcId);
        try {
            await axios.delete(`/api/problems/testcases/${tcId}`);
            setProblemTcs(prev => ({ ...prev, [problemId]: (prev[problemId] || []).filter(t => t.id !== tcId) }));
        } catch { alert('Failed to delete'); }
        setTcDeleting(null);
    };

    const saveHint = async (problemId: string) => {
        const content = newHintText[problemId]?.trim();
        if (!content) return;
        setHintSaving(problemId);
        try {
            await axios.post(`/api/problems/${problemId}/hints`, { content });
            const res = await axios.get(`/api/problems/${problemId}/hints`);
            setProblemHints(prev => ({ ...prev, [problemId]: res.data.hints || [] }));
            setNewHintText(prev => ({ ...prev, [problemId]: '' }));
        } catch (e: any) { alert(e.response?.data?.message || 'Failed to save hint'); }
        setHintSaving(null);
    };

    const deleteHint = async (problemId: string, hintId: string) => {
        if (!confirm('Delete this hint?')) return;
        setHintDeleting(hintId);
        try {
            await axios.delete(`/api/problems/hints/${hintId}`);
            setProblemHints(prev => ({ ...prev, [problemId]: (prev[problemId] || []).filter(h => h.id !== hintId) }));
        } catch { alert('Failed to delete hint'); }
        setHintDeleting(null);
    };

    // ── Tournament handlers ─────────────────────────────────────────────
    const handleCreateTournament = async () => {
        if (tPairs < 1 || tPairs > 50) { setTError('Pairs must be 1–50'); return; }
        setTCreating(true); setTError(''); setTResult(null);
        try {
            const res = await axios.post('/api/tournament/bulk-create', {
                pairs: tPairs,
                questionCount: tQCount,
                name: tName || `Tournament ${new Date().toLocaleDateString()}`,
            });
            setTResult(res.data);
        } catch (e: any) {
            setTError(e.response?.data?.error || 'Failed to create tournament');
        }
        setTCreating(false);
    };

    const copyT = async (text: string, key: string) => {
        await navigator.clipboard.writeText(text);
        setTCopied(key);
        setTimeout(() => setTCopied(null), 2000);
    };

    const downloadTournamentCSV = () => {
        if (!tResult) return;
        const rows = ['Pair,Room Code,Team A Code,Team B Code'];
        tResult.pairs.forEach(p => rows.push(`${p.pairNo},${p.roomCode},${p.teamACode},${p.teamBCode}`));
        const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${tResult.name}.csv`; a.click();
        URL.revokeObjectURL(url);
    };

    const handleStartTournament = async () => {
        if (!tResult) return;
        if (!confirm(`Start all ${tResult.pairs.length} rooms in "${tResult.name}"? Teams will see a 30-second countdown.`)) return;
        setTStarting(true); setTError('');
        try {
            // Broadcast countdown to all connected teams
            await axios.post(`/api/tournament/${tResult.tournamentId}/notify-countdown`, { seconds: 30 });
        } catch { /* non-fatal — teams not yet connected is fine */ }

        // Local admin countdown
        setTCountdown(30);
        if (tCountdownRef.current) clearInterval(tCountdownRef.current);
        tCountdownRef.current = setInterval(() => {
            setTCountdown(prev => {
                if (prev === null || prev <= 1) {
                    clearInterval(tCountdownRef.current!);
                    return null;
                }
                return prev - 1;
            });
        }, 1000);

        // After 30s, call start
        setTimeout(async () => {
            try {
                await axios.post(`/api/tournament/${tResult!.tournamentId}/start`);
            } catch (e: any) {
                setTError(e.response?.data?.error || 'Failed to start tournament');
            }
            setTStarting(false);
            setTCountdown(null);
        }, 30000);
    };

    // ── Health handlers ────────────────────────────────────
    const checkHealth = async () => {
        setHealthLoading(true); setHealthError('');
        try {
            const [hRes, pRes] = await Promise.all([
                axios.get('/health'),
                axios.get('/api/problems'),
            ]);
            setHealth(hRes.data);
            const ps = pRes.data.problems || [];
            const allTcRes = await Promise.all(ps.slice(0, 5).map((p: Problem) =>
                axios.get(`/api/problems/${p.id}/testcases/all`).then(r => r.data.testcases?.length || 0).catch(() => 0)
            ));
            setDbStats({ problems: ps.length, testcases: allTcRes.reduce((a: number, b: number) => a + b, 0) });
        } catch (e: any) { setHealthError(e.message || 'Health check failed'); }
        setHealthLoading(false);
    };
    useEffect(() => { if (adminTab === 'health') checkHealth(); }, [adminTab]);

    const teamAJoined = !!room?.teams.A.name;
    const teamBJoined = !!room?.teams.B.name;
    const bothJoined = teamAJoined && teamBJoined;
    const gameStarted = room?.phase === 'playing' || room?.phase === 'grid_pick' || room?.phase === 'ended';

    return (
        <div className="admin-root">
            <div className="admin-orb orb-1" />
            <div className="admin-orb orb-2" />
            <div className="admin-container">
                {/* Header */}
                <div className="admin-header">
                    <div className="admin-header-icon">
                        <Settings size={28} color={connected ? "var(--neon-cyan)" : "var(--text-muted)"} />
                        {!connected && <span className="conn-warning">⚠️ Disconnected</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                        <h1 className="admin-title gradient-text">Game Control Panel</h1>
                        <p className="admin-sub">{connected ? "Server Connected" : "Connecting..."} · CodeArena Admin</p>
                    </div>
                    {adminTab === 'game' && !codes && (
                        <div className="admin-restore-box">
                            <input className="restore-input" placeholder="Restore Admin Code..." value={adminInput}
                                onChange={(e) => setAdminInput(e.target.value.toUpperCase())}
                                onKeyDown={(e) => e.key === 'Enter' && handleRestore()} />
                            <button className="btn btn-secondary restore-btn" onClick={handleRestore} disabled={restoring}>
                                {restoring ? <RefreshCw size={14} className="spinning" /> : 'Restore'}
                            </button>
                        </div>
                    )}
                </div>

                {/* Tab nav */}
                <div className="admin-tab-nav">
                    <button className={`admin-tab-btn ${adminTab === 'game' ? 'active' : ''}`} onClick={() => setAdminTab('game')}>
                        <Swords size={15} /> Game Control
                    </button>
                    <button className={`admin-tab-btn ${adminTab === 'tournament' ? 'active' : ''}`} onClick={() => setAdminTab('tournament')}>
                        <Trophy size={15} /> Tournament
                    </button>
                    <button className={`admin-tab-btn ${adminTab === 'problems' ? 'active' : ''}`} onClick={() => setAdminTab('problems')}>
                        <Database size={15} /> Problem Manager
                    </button>
                    <button className={`admin-tab-btn ${adminTab === 'health' ? 'active' : ''}`} onClick={() => setAdminTab('health')}>
                        <Activity size={15} /> Health Monitor
                    </button>
                </div>

                {/* ══ GAME TAB ══ */}
                {adminTab === 'game' && (<>
                    <div className={`admin-card glass-panel ${codes ? 'done' : ''}`}>
                        <div className="admin-step-badge">Step 1</div>
                        <h2 className="admin-card-title">Create Game Room</h2>
                        <div className="admin-row">
                            <div className="admin-field">
                                <label>Number of Questions</label>
                                <div className="q-count-row">
                                    {[15, 16, 17].map(n => (
                                        <button key={n} className={`q-count-btn ${questionCount === n ? 'active' : ''}`}
                                            onClick={() => setQuestionCount(n)} disabled={!!codes}>{n}</button>
                                    ))}
                                </div>
                                <span className="admin-hint">First 3 = knife questions · Last 1 = bonus</span>
                            </div>
                            <button className="btn btn-primary admin-create-btn" onClick={handleCreate} disabled={creating || !!codes}>
                                {creating ? <RefreshCw size={16} className="spinning" /> : <Play size={16} />}
                                {creating ? 'Creating…' : codes ? '✅ Room Created' : 'Create Room'}
                            </button>
                        </div>
                        {error && <div className="admin-error">{error}</div>}
                    </div>

                    {codes && (
                        <div className="admin-card glass-panel">
                            <div className="admin-step-badge">Step 2</div>
                            <h2 className="admin-card-title">Share Team Codes</h2>
                            <p className="admin-sub">Give each team their code. They enter it at the Lobby page.</p>
                            <div className="codes-grid">
                                <div className="team-code-card team-a-card">
                                    <div className="team-code-header">
                                        <Swords size={16} color="var(--neon-cyan)" />
                                        <span>Team A Code</span>
                                        <span className="code-status">{teamAJoined ? `✅ ${room!.teams.A.name}` : '⏳ Waiting…'}</span>
                                    </div>
                                    <div className="team-code-value">{codes.teamACode}</div>
                                    <button className="copy-btn" onClick={() => copyToClipboard(codes.teamACode, 'a')}>
                                        {copied === 'a' ? <Check size={14} /> : <Copy size={14} />} {copied === 'a' ? 'Copied!' : 'Copy'}
                                    </button>
                                </div>
                                <div className="team-code-card team-b-card">
                                    <div className="team-code-header">
                                        <Swords size={16} color="var(--neon-purple)" />
                                        <span>Team B Code</span>
                                        <span className="code-status">{teamBJoined ? `✅ ${room!.teams.B.name}` : '⏳ Waiting…'}</span>
                                    </div>
                                    <div className="team-code-value">{codes.teamBCode}</div>
                                    <button className="copy-btn" onClick={() => copyToClipboard(codes.teamBCode, 'b')}>
                                        {copied === 'b' ? <Check size={14} /> : <Copy size={14} />} {copied === 'b' ? 'Copied!' : 'Copy'}
                                    </button>
                                </div>
                            </div>
                            <div className="admin-code-strip">
                                <span className="admin-code-label">🔑 Admin Code</span>
                                <span className="admin-code-val">{codes.adminCode}</span>
                                <button className="copy-btn" onClick={() => copyToClipboard(codes.adminCode, 'admin')}>
                                    {copied === 'admin' ? <Check size={14} /> : <Copy size={14} />}
                                </button>
                            </div>
                        </div>
                    )}

                    {codes && (
                        <div className="admin-card glass-panel">
                            <div className="admin-step-badge">Step 3</div>
                            <h2 className="admin-card-title">Launch Arena</h2>
                            <div className="teams-live">
                                <div className={`team-live-chip ${teamAJoined ? 'connected' : 'waiting'}`}>
                                    <Users size={16} /><span>{room?.teams.A.name || 'Team A'}</span>
                                    <span className="live-badge">{teamAJoined ? '🟢 Connected' : '🟡 Waiting'}</span>
                                </div>
                                <div className={`team-live-chip ${teamBJoined ? 'connected' : 'waiting'}`}>
                                    <Users size={16} /><span>{room?.teams.B.name || 'Team B'}</span>
                                    <span className="live-badge">{teamBJoined ? '🟢 Connected' : '🟡 Waiting'}</span>
                                </div>
                            </div>
                            {!gameStarted && (
                                <div className="admin-launch-section">
                                    <div className={`admin-status-message ${bothJoined && connected ? 'ready' : ''}`}>
                                        {!connected ? "⚠️ Waiting for server..." : !bothJoined ? "⏳ Waiting for both teams..." : "🚀 Ready to launch!"}
                                    </div>
                                    <button className={`btn btn-primary big-start-btn ${bothJoined && connected ? 'ready' : ''}`}
                                        onClick={handleStart} disabled={!bothJoined || starting || !connected}>
                                        {starting ? <><RefreshCw size={24} className="spinning" /> LAUNCHING...</>
                                            : bothJoined ? <><Play size={24} /> START THE BATTLE!</> : 'WAITING...'}
                                    </button>
                                </div>
                            )}
                            {gameStarted && room?.phase !== 'ended' && (
                                <div className="game-live-banner">
                                    <span>🎮 Game is LIVE!</span>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                        {room?.teams.A.name} vs {room?.teams.B.name} · {room?.questionCount} questions
                                    </span>
                                </div>
                            )}
                            {room?.phase === 'ended' && (
                                <div className="game-over-banner">
                                    <div className="game-over-title">🏁 GAME OVER</div>
                                    {room.winner === 'tie' ? (
                                        <div className="game-over-result tie">🤝 It's a TIE!</div>
                                    ) : (
                                        <div className="game-over-result winner">
                                            🏆 Winner: <strong>
                                                {room.winner === 'A' ? room.teams.A.name : room.teams.B.name}
                                            </strong> (Team {room.winner})
                                        </div>
                                    )}
                                    <div className="game-over-teams">
                                        {room?.teams.A.name} vs {room?.teams.B.name}
                                    </div>
                                </div>
                            )}
                            {error && <div className="admin-error" style={{ marginTop: '12px' }}>{error}</div>}
                        </div>
                    )}
                    {!codes && (
                        <div className="admin-instructions glass-panel">
                            <h3>How it works</h3>
                            <ol>
                                <li>Click <strong>Create Room</strong> to generate a unique game session</li>
                                <li>Share <strong>Team A Code</strong> and <strong>Team B Code</strong> with each team</li>
                                <li>Teams go to <code>/</code> (Lobby) and enter their code + name</li>
                                <li>Once both connected, click <strong>Start the Battle!</strong></li>
                            </ol>
                        </div>
                    )}
                </>)}

                {/* ══ TOURNAMENT TAB ══ */}
                {adminTab === 'tournament' && (
                    <div className="admin-card glass-panel">
                        <h2 className="admin-card-title">Create Tournament</h2>
                        <p className="admin-sub">Create N parallel 1v1 rooms with the same problem set. All teams compete on a global leaderboard.</p>

                        {!tResult && (
                            <div className="t-form">
                                <div className="t-form-row">
                                    <div className="admin-field">
                                        <label>Tournament Name</label>
                                        <input className="admin-input" placeholder="e.g. Semester Finals 2025"
                                            value={tName} onChange={e => setTName(e.target.value)} />
                                    </div>
                                </div>
                                <div className="t-form-row">
                                    <div className="admin-field">
                                        <label>Number of 1v1 Pairs <span className="admin-hint">(1–50)</span></label>
                                        <div className="q-count-row">
                                            {[2, 4, 8, 10, 20, 40].map(n => (
                                                <button key={n} className={`q-count-btn ${tPairs === n ? 'active' : ''}`}
                                                    onClick={() => setTPairs(n)}>{n}</button>
                                            ))}
                                            <input type="number" className="admin-input" style={{ width: 80 }}
                                                min={1} max={50} value={tPairs}
                                                onChange={e => setTPairs(Number(e.target.value))} />
                                        </div>
                                        <span className="admin-hint">📊 {tPairs} rooms × 2 teams = {tPairs * 2} teams total</span>
                                    </div>
                                    <div className="admin-field">
                                        <label>Questions per Room</label>
                                        <div className="q-count-row">
                                            {[15, 16, 17].map(n => (
                                                <button key={n} className={`q-count-btn ${tQCount === n ? 'active' : ''}`}
                                                    onClick={() => setTQCount(n)}>{n}</button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                {tError && <div className="admin-error">{tError}</div>}
                                <button className="btn btn-primary admin-create-btn" onClick={handleCreateTournament} disabled={tCreating}>
                                    {tCreating ? <><RefreshCw size={16} className="spinning" /> Creating {tPairs} rooms...</> : <><Trophy size={16} /> Create Tournament</>}
                                </button>
                            </div>
                        )}

                        {tResult && (
                            <div className="t-result">
                                <div className="t-result-header">
                                    <div>
                                        <div className="t-result-name">🏆 {tResult.name}</div>
                                        <div className="admin-sub">{tResult.pairs.length} rooms created · {tResult.pairs.length * 2} teams</div>
                                    </div>
                                    <div className="t-result-actions">
                                        <button className="btn btn-secondary" onClick={downloadTournamentCSV} disabled={tStarting}>
                                            <Download size={14} /> Download CSV
                                        </button>
                                        <button className="btn btn-primary" onClick={() => navigate(`/leaderboard/${tResult!.tournamentId}?admin=1`)}>
                                            <Trophy size={14} /> View Leaderboard
                                        </button>
                                        {!tStarting && tCountdown === null && (
                                            <button
                                                className="btn"
                                                style={{ background: 'linear-gradient(135deg,#059669,#2563eb)', color: '#fff', fontWeight: 800, padding: '8px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                                                onClick={handleStartTournament}
                                            >
                                                🚀 Start Contest
                                            </button>
                                        )}
                                        {tStarting && tCountdown !== null && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 18px', background: '#fef3c7', border: '1.5px solid #f59e0b', borderRadius: 10 }}>
                                                <span style={{ fontSize: '1.3rem', fontWeight: 900, color: tCountdown <= 5 ? '#dc2626' : '#d97706', minWidth: 28, textAlign: 'right' }}>{tCountdown}</span>
                                                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#92400e' }}>sec · Starting all rooms…</span>
                                            </div>
                                        )}
                                        {tStarting && tCountdown === null && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: '#f0fdf4', borderRadius: 10, border: '1.5px solid #86efac' }}>
                                                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#059669' }}>✅ Contest launched!</span>
                                            </div>
                                        )}
                                        <button className="btn btn-secondary" onClick={() => { setTResult(null); setTName(''); setTStarting(false); setTCountdown(null); }}>
                                            Create Another
                                        </button>
                                    </div>
                                </div>
                                <div className="t-pairs-table-wrap">
                                    <table className="t-pairs-table">
                                        <thead>
                                            <tr>
                                                <th>#</th>
                                                <th>Team A Code</th>
                                                <th>Team B Code</th>
                                                <th>Room Code</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {tResult.pairs.map(pair => (
                                                <tr key={pair.pairNo}>
                                                    <td className="t-pair-no">{pair.pairNo}</td>
                                                    <td>
                                                        <div className="t-code-cell">
                                                            <span className="t-code team-a">{pair.teamACode}</span>
                                                            <button className="copy-btn-sm" onClick={() => copyT(pair.teamACode, `a${pair.pairNo}`)}>
                                                                {tCopied === `a${pair.pairNo}` ? <Check size={12} /> : <Copy size={12} />}
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className="t-code-cell">
                                                            <span className="t-code team-b">{pair.teamBCode}</span>
                                                            <button className="copy-btn-sm" onClick={() => copyT(pair.teamBCode, `b${pair.pairNo}`)}>
                                                                {tCopied === `b${pair.pairNo}` ? <Check size={12} /> : <Copy size={12} />}
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className="t-code-cell">
                                                            <span className="t-code">{pair.roomCode}</span>
                                                            <button className="copy-btn-sm" onClick={() => copyT(pair.roomCode, `r${pair.pairNo}`)}>
                                                                {tCopied === `r${pair.pairNo}` ? <Check size={12} /> : <Copy size={12} />}
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {adminTab === 'problems' && (
                    <div className="admin-card glass-panel">
                        <div className="pm-header">
                            <h2 className="admin-card-title" style={{ margin: 0 }}>Problem Manager</h2>
                            <button className="btn btn-secondary pm-refresh" onClick={loadProblems} disabled={problemsLoading}>
                                <RefreshCw size={14} className={problemsLoading ? 'spinning' : ''} /> Refresh
                            </button>
                        </div>
                        <p className="admin-sub">Add or remove test cases for any problem. Hidden test cases are used for judging only.</p>
                        {problemsLoading ? (
                            <div className="pm-loading"><RefreshCw size={18} className="spinning" /> Loading problems...</div>
                        ) : (
                            <div className="pm-list">
                                {problems.map(p => (
                                    <div key={p.id} className={`pm-problem ${expandedProblem === p.id ? 'expanded' : ''}`}>
                                        <button className="pm-problem-header" onClick={() => toggleProblem(p.id)}>
                                            <span className="pm-problem-title">{p.title}</span>
                                            <div className="pm-problem-meta">
                                                <span className={`pm-diff ${p.difficulty?.toLowerCase()}`}>{p.difficulty}</span>
                                                <span className={`pm-pub ${p.is_published ? 'yes' : 'no'}`}>
                                                    {p.is_published ? '✅ Published' : '⬜ Draft'}
                                                </span>
                                                <span className="pm-tc-count">
                                                    {problemTcs[p.id] ? `${problemTcs[p.id].length} TC` : '...'}
                                                </span>
                                                {expandedProblem === p.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                            </div>
                                        </button>

                                        {expandedProblem === p.id && (
                                            <div className="pm-tc-panel">
                                                {/* Existing test cases */}
                                                <div className="pm-tc-list">
                                                    {(problemTcs[p.id] || []).map((tc, i) => (
                                                        <div key={tc.id} className={`pm-tc-row ${tc.is_sample ? 'sample' : 'hidden'}`}>
                                                            <div className="pm-tc-idx">TC{i + 1}</div>
                                                            <span className={`pm-tc-badge ${tc.is_sample ? 'sample' : 'hidden'}`}>
                                                                {tc.is_sample ? 'Sample' : 'Hidden'}
                                                            </span>
                                                            <div className="pm-tc-io">
                                                                <div className="pm-tc-field">
                                                                    <span className="pm-tc-label">Input</span>
                                                                    <pre className="pm-tc-pre">{tc.input || '(empty)'}</pre>
                                                                </div>
                                                                <div className="pm-tc-field">
                                                                    <span className="pm-tc-label">Expected</span>
                                                                    <pre className="pm-tc-pre">{tc.expected_output}</pre>
                                                                </div>
                                                            </div>
                                                            <button className="pm-tc-del" title="Delete"
                                                                onClick={() => deleteTestCase(p.id, tc.id)}
                                                                disabled={tcDeleting === tc.id}>
                                                                {tcDeleting === tc.id ? <RefreshCw size={13} className="spinning" /> : <Trash2 size={13} />}
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>

                                                {/* Add new TC form */}
                                                <div className="pm-add-tc">
                                                    <div className="pm-add-tc-title"><Plus size={14} /> Add Test Case</div>
                                                    <div className="pm-add-tc-fields">
                                                        <div className="pm-add-field">
                                                            <label>Input (stdin)</label>
                                                            <textarea className="pm-textarea"
                                                                placeholder="Leave empty if no input"
                                                                value={newTc[p.id]?.input || ''}
                                                                onChange={e => setNewTc(prev => ({ ...prev, [p.id]: { ...prev[p.id], input: e.target.value } }))}
                                                            />
                                                        </div>
                                                        <div className="pm-add-field">
                                                            <label>Expected Output</label>
                                                            <textarea className="pm-textarea"
                                                                placeholder="Exact expected output"
                                                                value={newTc[p.id]?.expected_output || ''}
                                                                onChange={e => setNewTc(prev => ({ ...prev, [p.id]: { ...prev[p.id], expected_output: e.target.value } }))}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="pm-add-tc-footer">
                                                        <label className="pm-checkbox">
                                                            <input type="checkbox"
                                                                checked={newTc[p.id]?.is_sample ?? true}
                                                                onChange={e => setNewTc(prev => ({ ...prev, [p.id]: { ...prev[p.id], is_sample: e.target.checked } }))}
                                                            />
                                                            <span>Sample (visible to players)</span>
                                                        </label>
                                                        <button className="btn btn-primary pm-save-btn"
                                                            onClick={() => saveTestCase(p.id)}
                                                            disabled={tcSaving === p.id || !newTc[p.id]?.expected_output?.trim()}>
                                                            {tcSaving === p.id ? <RefreshCw size={14} className="spinning" /> : <Plus size={14} />}
                                                            Add Test Case
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Hints section */}
                                                <div className="pm-hints-section">
                                                    <div className="pm-add-tc-title"><Lightbulb size={14} /> Hints <span className="admin-hint">({(problemHints[p.id] || []).length} hints)</span></div>
                                                    {(problemHints[p.id] || []).map((hint, hi) => (
                                                        <div key={hint.id} className="pm-hint-row">
                                                            <span className="pm-hint-idx">#{hi + 1}</span>
                                                            <span className="pm-hint-content">{hint.content}</span>
                                                            <button className="pm-tc-del" title="Delete hint"
                                                                onClick={() => deleteHint(p.id, hint.id)}
                                                                disabled={hintDeleting === hint.id}>
                                                                {hintDeleting === hint.id ? <RefreshCw size={13} className="spinning" /> : <Trash2 size={13} />}
                                                            </button>
                                                        </div>
                                                    ))}
                                                    <div className="pm-add-hint-row">
                                                        <input className="admin-input" placeholder="Enter hint text..."
                                                            value={newHintText[p.id] || ''}
                                                            onChange={e => setNewHintText(prev => ({ ...prev, [p.id]: e.target.value }))}
                                                            onKeyDown={e => e.key === 'Enter' && saveHint(p.id)}
                                                        />
                                                        <button className="btn btn-primary pm-save-btn"
                                                            onClick={() => saveHint(p.id)}
                                                            disabled={hintSaving === p.id || !newHintText[p.id]?.trim()}>
                                                            {hintSaving === p.id ? <RefreshCw size={14} className="spinning" /> : <Plus size={14} />}
                                                            Add Hint
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ══ HEALTH TAB ══ */}
                {adminTab === 'health' && (
                    <div className="admin-card glass-panel">
                        <div className="pm-header">
                            <h2 className="admin-card-title" style={{ margin: 0 }}>System Health</h2>
                            <button className="btn btn-secondary pm-refresh" onClick={checkHealth} disabled={healthLoading}>
                                <RefreshCw size={14} className={healthLoading ? 'spinning' : ''} /> Refresh
                            </button>
                        </div>
                        {healthError && <div className="admin-error">{healthError}</div>}
                        {healthLoading && <div className="pm-loading"><RefreshCw size={18} className="spinning" /> Checking services...</div>}
                        {health && !healthLoading && (
                            <div className="health-grid">
                                <div className={`health-card ${health.api === 'up' ? 'ok' : 'fail'}`}>
                                    <Heart size={20} />
                                    <div className="health-name">API Server</div>
                                    <div className="health-val">{health.api === 'up' ? '🟢 UP' : '🔴 DOWN'}</div>
                                    {health.uptime && <div className="health-sub">Uptime: {Math.floor(health.uptime / 60)}m {health.uptime % 60}s</div>}
                                </div>
                                <div className={`health-card ${health.db === 'up' ? 'ok' : 'fail'}`}>
                                    <Database size={20} />
                                    <div className="health-name">PostgreSQL</div>
                                    <div className="health-val">{health.db === 'up' ? '🟢 UP' : '🔴 DOWN'}</div>
                                    {dbStats && <div className="health-sub">{dbStats.problems} problems · {dbStats.testcases}+ TCs</div>}
                                </div>
                                <div className={`health-card ${health.redis === 'up' ? 'ok' : 'fail'}`}>
                                    <Activity size={20} />
                                    <div className="health-name">Redis / Queue</div>
                                    <div className="health-val">{health.redis === 'up' ? '🟢 UP' : '🔴 DOWN'}</div>
                                    <div className="health-sub">Bull job queue</div>
                                </div>
                                <div className={`health-card ${connected ? 'ok' : 'fail'}`}>
                                    <Swords size={20} />
                                    <div className="health-name">WebSocket</div>
                                    <div className="health-val">{connected ? '🟢 Connected' : '🔴 Disconnected'}</div>
                                    <div className="health-sub">Game server</div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
