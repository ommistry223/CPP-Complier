import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameSocket } from '../hooks/useGameSocket';
import './Lobby.css';

const TEAM_ICONS = ['🔥', '💀', '👾', '💫', '⚡', '🤖'];

export default function Lobby() {
    const navigate = useNavigate();
    const [teamCode, setTeamCode] = useState('');
    const [teamName, setTeamName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [joined, setJoined] = useState(false);
    const [myTeam, setMyTeam] = useState<'A' | 'B' | null>(null);
    const [room, setRoom] = useState<any>(null);
    const [myTeamName, setMyTeamName] = useState('');
    const [dots, setDots] = useState('');
    const [countdown, setCountdown] = useState<number | null>(null);
    const [countdownName, setCountdownName] = useState('');
    const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Ref to capture current join data for the socket callback (avoids stale closure)
    const joinDataRef = useRef({ teamCode: '', teamName: '' });
    const [selectedIcon, setSelectedIcon] = useState('🔥');

    /* Animated waiting dots */
    useEffect(() => {
        if (!joined) return;
        const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 500);
        return () => clearInterval(t);
    }, [joined]);

    const { send, connected } = useGameSocket(useCallback((msg: any) => {
        if (msg.type === 'joined') {
            setJoined(true); setMyTeam(msg.teamId); setRoom(msg.room); setLoading(false);
            // If game already started (rejoin after logout), navigate straight to game
            if (msg.room?.phase === 'playing' || msg.room?.phase === 'grid_pick') {
                navigate('/game', { state: { room: msg.room, myTeam: msg.teamId, teamName: joinDataRef.current.teamName, teamCode: joinDataRef.current.teamCode } });
            }
        }
        if (msg.type === 'room_updated' && joined) setRoom(msg.room);
        if (msg.type === 'game_countdown') {
            // tournament countdown broadcast: { endsAt: timestamp, tournamentName }
            const secs = Math.max(1, Math.ceil((msg.endsAt - Date.now()) / 1000));
            setCountdown(secs);
            setCountdownName(msg.tournamentName || 'Tournament');
            if (countdownRef.current) clearInterval(countdownRef.current);
            countdownRef.current = setInterval(() => {
                setCountdown(prev => {
                    if (prev === null || prev <= 1) {
                        if (countdownRef.current) clearInterval(countdownRef.current!);
                        return null;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        if (msg.type === 'game_started') {
            if (countdownRef.current) clearInterval(countdownRef.current!);
            setCountdown(null);
            navigate('/game', { state: { room: msg.room, myTeam, teamName: myTeamName, teamCode: teamCode.trim().toUpperCase() } });
        }
        if (msg.type === 'error') { setError(msg.message); setLoading(false); }
    }, [joined, myTeam, myTeamName, navigate, teamCode]));

    useEffect(() => {
        if (connected) {
            setError('');
            // Heartbeat
            const p = setInterval(() => send('ping'), 15000);
            return () => clearInterval(p);
        }
    }, [connected, send]);

    /* Cleanup countdown interval on unmount to prevent memory leak */
    useEffect(() => {
        return () => {
            if (countdownRef.current) clearInterval(countdownRef.current);
        };
    }, []);

    const handleJoin = () => {
        if (!connected) { setError('Not connected to server. Please wait...'); return; }
        if (!teamCode.trim()) { setError('Enter your team code'); return; }
        if (!teamName.trim()) { setError('Enter your team name'); return; }
        setError(''); setLoading(true);
        const fullName = selectedIcon + ' ' + teamName.trim();
        const normalizedCode = teamCode.trim().toUpperCase();
        setMyTeamName(fullName);
        joinDataRef.current = { teamCode: normalizedCode, teamName: fullName };
        send('join_with_team_code', { teamCode: normalizedCode, teamName: fullName });
    };

    const teamColor = myTeam === 'A' ? '#3b82f6' : '#8b5cf6';
    const bothReady = room?.teams?.A?.name && room?.teams?.B?.name;

    /* Auto-detect team from code prefix */
    const codeTeam = teamCode.startsWith('B') ? 'B' : teamCode.startsWith('A') ? 'A' : null;

    return (
        <div className="lobby-root">
            {/* Tournament countdown overlay */}
            {countdown !== null && (
                <div className="countdown-overlay">
                    <div className="countdown-box">
                        <div className="countdown-icon">🚀</div>
                        <div className="countdown-label">Contest Starting In</div>
                        <div className="countdown-tournament-name">{countdownName}</div>
                        <div className="countdown-ring-wrap">
                            <svg className="countdown-ring-svg" viewBox="0 0 160 160">
                                <defs>
                                    <linearGradient id="cdGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                        <stop offset="0%" stopColor="#2563eb" />
                                        <stop offset="100%" stopColor="#7c3aed" />
                                    </linearGradient>
                                </defs>
                                <circle className="countdown-ring-bg" cx="80" cy="80" r="68" />
                                <circle
                                    className="countdown-ring-fill"
                                    cx="80" cy="80" r="68"
                                    strokeDasharray={`${2 * Math.PI * 68}`}
                                    strokeDashoffset={`${2 * Math.PI * 68 * (1 - countdown / 30)}`}
                                />
                            </svg>
                            <span className={`countdown-number ${countdown <= 5 ? 'urgent' : ''}`}>{countdown}</span>
                        </div>
                        <div className="countdown-sub">Get ready — the arena is about to open!</div>
                        <div className="countdown-teams-count">⚔️ All rooms starting simultaneously</div>
                    </div>
                </div>
            )}

            <div className="lobby-layout">
                {/* ── LEFT: Branding panel ────────────────── */}
                <div className="lobby-left">
                    <div className="scan-line" />
                    <div className="lobby-brand">
                        <div className="lobby-brand-logo">
                            <div className="logo-grid">
                                <span className="logo-x">✕</span>
                                <span className="logo-sep" />
                                <span className="logo-o">○</span>
                            </div>
                        </div>
                        <h1 className="lobby-brand-title">
                            <span className="grad-cyan">Code</span>{' '}
                            <span className="grad-purple">Tic-Tac-Toe</span>
                        </h1>
                        <p className="lobby-brand-sub">
                            Two teams. 17 coding challenges. One Tic-Tac-Toe grid. Only the best coders survive.
                        </p>

                        <div className="lobby-stats-strip">
                            <div className="ls-item">
                                <span className="ls-num">17</span>
                                <span className="ls-label">Questions</span>
                            </div>
                            <div className="ls-divider" />
                            <div className="ls-item">
                                <span className="ls-num">3</span>
                                <span className="ls-label">Knives</span>
                            </div>
                            <div className="ls-divider" />
                            <div className="ls-item">
                                <span className="ls-num">9</span>
                                <span className="ls-label">Grid Cells</span>
                            </div>
                        </div>

                        {/* Mini feature list */}
                        <div className="lobby-features">
                            <div className="lobby-feat">
                                <span className="feat-icon">🔪</span>
                                <div>
                                    <div className="feat-title">Knife Mechanic</div>
                                    <div className="feat-desc">Solve Q1–Q3 to unlock knives. Steal opponent's cells.</div>
                                </div>
                            </div>
                            <div className="lobby-feat">
                                <span className="feat-icon">⚡</span>
                                <div>
                                    <div className="feat-title">Speed Scoring</div>
                                    <div className="feat-desc">Solve faster = more points. Speed bonus decays after 60s.</div>
                                </div>
                            </div>
                            <div className="lobby-feat">
                                <span className="feat-icon">⭐</span>
                                <div>
                                    <div className="feat-title">Bonus Round</div>
                                    <div className="feat-desc">Q17 awards 2 grid picks and 300+ bonus points.</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── RIGHT: Join card ────────────────────── */}
                <div className="lobby-right">
                    {!joined ? (
                        <div className="lobby-card">
                            <div className="lobby-card-header">
                                <div className="lch-badge">
                                    {codeTeam ? (
                                        <span style={{ color: codeTeam === 'A' ? '#3b82f6' : '#8b5cf6' }}>
                                            Team {codeTeam} detected
                                        </span>
                                    ) : 'Enter Your Code'}
                                </div>
                                <h2 className="lch-title">Join the Arena</h2>
                                <p className="lch-sub">Your admin will share your team code</p>
                            </div>

                            {/* Team code input */}
                            <div className="lc-field">
                                <label className="lc-label">Team Code</label>
                                <div className="lc-code-wrap">
                                    <input
                                        className={`lc-code-input ${codeTeam === 'A' ? 'code-team-a' : codeTeam === 'B' ? 'code-team-b' : ''}`}
                                        placeholder="A-XXXXXX"
                                        value={teamCode}
                                        onChange={e => { setTeamCode(e.target.value.toUpperCase()); setError(''); }}
                                        autoFocus
                                        maxLength={12}
                                        spellCheck={false}
                                    />
                                    {codeTeam && (
                                        <div className={`code-team-indicator ${codeTeam === 'A' ? 'ind-a' : 'ind-b'}`}>
                                            Team {codeTeam}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Team name input */}
                            <div className="lc-field">
                                <label className="lc-label">Team Name</label>
                                <input
                                    className="lc-input"
                                    placeholder="e.g. The Coders"
                                    value={teamName}
                                    onChange={e => { setTeamName(e.target.value); setError(''); }}
                                    onKeyDown={e => e.key === 'Enter' && handleJoin()}
                                    maxLength={20}
                                />
                            </div>

                            {/* Team icon picker */}
                            <div className="lc-field">
                                <label className="lc-label">Team Icon</label>
                                <div className="icon-picker">
                                    {TEAM_ICONS.map(icon => (
                                        <button
                                            key={icon}
                                            type="button"
                                            className={`icon-opt${selectedIcon === icon ? ' icon-selected' : ''}`}
                                            onClick={() => setSelectedIcon(icon)}
                                        >{icon}</button>
                                    ))}
                                </div>
                            </div>

                            {/* Preview */}
                            {teamName && (
                                <div className="lc-preview">
                                    <span className="lcp-label">Your team will appear as:</span>
                                    <span className="lcp-name" style={{ color: codeTeam === 'B' ? '#8b5cf6' : '#3b82f6' }}>
                                        {selectedIcon} {teamName}
                                    </span>
                                </div>
                            )}

                            {/* Error */}
                            {error && (
                                <div className="lc-error">
                                    <span className="lc-error-icon">!</span> {error}
                                </div>
                            )}

                            {/* Join button */}
                            <button
                                className={`lc-join-btn ${loading || !connected ? 'btn-loading' : ''}`}
                                onClick={handleJoin}
                                disabled={loading || !connected}
                            >
                                {loading ? (
                                    <span className="btn-spinner" />
                                ) : !connected ? (
                                    <span>Connecting...</span>
                                ) : (
                                    <>
                                        <span>Enter the Arena</span>
                                        <span className="lc-btn-arrow">→</span>
                                    </>
                                )}
                            </button>

                            {/* Rules mini strip */}
                            <div className="lc-rules">
                                <div className="lcr-item"><span className="lcr-dot" /> Q1–3 unlock Knives</div>
                                <div className="lcr-item"><span className="lcr-dot" /> Solve fast = more pts</div>
                                <div className="lcr-item"><span className="lcr-dot" /> Win cell per solve</div>
                                <div className="lcr-item"><span className="lcr-dot" /> Bonus Q = 2 picks</div>
                            </div>
                        </div>
                    ) : (
                        /* ── Waiting Room ─────────────────────── */
                        <div className="lobby-card lobby-waiting-card">
                            {/* Pulse ring */}
                            <div className="waiting-pulse-ring" style={{ borderColor: teamColor }} />

                            <div className="waiting-top">
                                <div className="waiting-team-badge" style={{ borderColor: teamColor, color: teamColor }}>
                                    Team {myTeam}
                                </div>
                                <div className="waiting-name" style={{ color: teamColor }}>{myTeamName}</div>
                                <div className="waiting-status-pill">
                                    <span className="pulse-dot"></span>
                                    {bothReady ? 'READY TO BATTLE' : 'WAITING FOR OPPONENT'}
                                </div>
                                <p className="waiting-sub">Waiting for the admin to launch the arena{dots}</p>
                            </div>

                            {/* Team status */}
                            <div className="waiting-teams">
                                <div className="wt-title">Teams Connected</div>
                                <div className="wt-grid">
                                    <div className={`wt-card ${room?.teams?.A?.name ? 'wt-ready' : 'wt-waiting'}`} style={{ borderColor: room?.teams?.A?.name ? '#3b82f6' : '#e2e8f0' }}>
                                        <span className="wt-icon">{room?.teams?.A?.name ? '✅' : '⏳'}</span>
                                        <span className="wt-team-id" style={{ color: '#3b82f6' }}>Team A</span>
                                        <span className="wt-team-name">{room?.teams?.A?.name || 'Waiting…'}</span>
                                    </div>
                                    <div className="wt-vs">VS</div>
                                    <div className={`wt-card ${room?.teams?.B?.name ? 'wt-ready' : 'wt-waiting'}`} style={{ borderColor: room?.teams?.B?.name ? '#8b5cf6' : '#e2e8f0' }}>
                                        <span className="wt-icon">{room?.teams?.B?.name ? '✅' : '⏳'}</span>
                                        <span className="wt-team-id" style={{ color: '#8b5cf6' }}>Team B</span>
                                        <span className="wt-team-name">{room?.teams?.B?.name || 'Waiting…'}</span>
                                    </div>
                                </div>

                                <div className={`wt-status ${bothReady ? 'wt-status-ready' : ''}`}>
                                    {bothReady
                                        ? '⚔️ Both teams ready! Admin will start the game soon.'
                                        : '⏳ Waiting for the other team to join…'}
                                </div>
                            </div>

                            {/* Mini grid preview */}
                            <div className="waiting-mini-grid">
                                {Array(9).fill(null).map((_, i) => (
                                    <div key={i} className="wmg-cell" style={{ animationDelay: `${i * 0.1}s` }} />
                                ))}
                            </div>
                            <p className="waiting-grid-label">Get ready — the battle grid awaits</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
