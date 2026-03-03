import { useEffect, useState, useMemo } from 'react';
import './BattleIntro.css';

interface Props {
    teamA: string;
    teamB: string;
    onDone: () => void;
}

/* ── deterministic particle field ─────────────────────────────── */
function makeParticles(n: number) {
    const out = [];
    for (let i = 0; i < n; i++) {
        // Pseudo-random but stable per index
        const seed1 = (i * 137 + 47) % 100;
        const seed2 = (i * 251 + 13) % 100;
        const seed3 = (i * 97  + 71) % 40 + 30;  // 30–70
        const seed4 = (i * 173 + 19) % 28 + 6;   // delay 0–2.8s
        const seed5 = (i * 61  + 83) % 20 + 10;  // size 10–30
        out.push({
            left: seed1,        // 0–100%
            top:  seed2,        // 0–100%
            dur:  seed3 / 10,   // 3.0–7.0s
            del:  seed4 / 10,   // 0.6–3.4s
            size: seed5,        // 10–30px
            side: i % 3,        // 0=left glow, 1=right glow, 2=white
        });
    }
    return out;
}

/* ── spark arcs along the center axis ─────────────────────────── */
function makeSparks(n: number) {
    return Array.from({ length: n }, (_, i) => ({
        del: ((i * 137) % 25) / 10 + 1.5,   // 1.5–4.0s delay
        dur: ((i * 97)  % 15) / 10 + 0.4,   // 0.4–1.9s duration
        y:   ((i * 211) % 80) + 10,          // 10–90% vertical
    }));
}

export default function BattleIntro({ teamA, teamB, onDone }: Props) {
    const [phase, setPhase] = useState<'entering' | 'active' | 'burst' | 'exiting'>('entering');
    const particles = useMemo(() => makeParticles(28), []);
    const sparks    = useMemo(() => makeSparks(12), []);

    useEffect(() => {
        const t1 = setTimeout(() => setPhase('active'),  1600);
        const t2 = setTimeout(() => setPhase('burst'),   3400);
        const t3 = setTimeout(() => setPhase('exiting'), 3700);
        const t4 = setTimeout(() => onDone(),            4300);
        return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
    }, [onDone]);

    const initials = (name: string) => name?.slice(0, 2).toUpperCase() || '??';

    return (
        <div className={`bi-overlay bi-phase-${phase}`}>

            {/* ── Background grid & radial rays ─── */}
            <div className="bi-bg">
                <div className="bi-bg-grid" />
                <div className="bi-bg-vignette" />
                {/* Radial spokes from center */}
                <svg className="bi-bg-rays" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice">
                    {Array.from({ length: 18 }, (_, i) => {
                        const angle = (i / 18) * 360;
                        const rad   = (angle * Math.PI) / 180;
                        return (
                            <line
                                key={i}
                                x1="500" y1="300"
                                x2={500 + Math.cos(rad) * 700}
                                y2={300 + Math.sin(rad) * 700}
                                stroke="rgba(255,255,255,0.025)"
                                strokeWidth="1"
                            />
                        );
                    })}
                </svg>
            </div>

            {/* ── Ambient glow orbs ─── */}
            <div className="bi-orb bi-orb-a" />
            <div className="bi-orb bi-orb-b" />

            {/* ── Floating particles ─── */}
            <div className="bi-particles">
                {particles.map((p, i) => (
                    <div
                        key={i}
                        className={`bi-particle bi-particle-${p.side}`}
                        style={{
                            left:              `${p.left}%`,
                            top:               `${p.top}%`,
                            width:             `${p.size}px`,
                            height:            `${p.size}px`,
                            animationDuration: `${p.dur}s`,
                            animationDelay:    `${p.del}s`,
                        }}
                    />
                ))}
            </div>

            {/* ── Main arena flex row ─── */}
            <div className="bi-arena">

                {/* ──── TEAM A ──── */}
                <div className="bi-team-pod bi-pod-a">
                    <div className="bi-pod-glow bi-pod-glow-a" />

                    {/* Neon ring */}
                    <svg className="bi-ring-svg" viewBox="0 0 300 300">
                        <defs>
                            <filter id="bi-glow-a" x="-50%" y="-50%" width="200%" height="200%">
                                <feGaussianBlur stdDeviation="6" result="blur1"/>
                                <feGaussianBlur stdDeviation="14" result="blur2"/>
                                <feMerge>
                                    <feMergeNode in="blur2"/>
                                    <feMergeNode in="blur1"/>
                                    <feMergeNode in="SourceGraphic"/>
                                </feMerge>
                            </filter>
                        </defs>
                        {/* Outer glow ring */}
                        <circle className="bi-ring bi-ring-outer bi-ring-a-outer"
                            cx="150" cy="150" r="128"
                            fill="none" stroke="#e040fb" strokeWidth="8" strokeLinecap="round"
                            pathLength="1"
                            filter="url(#bi-glow-a)"
                        />
                        {/* Sharp inner ring */}
                        <circle className="bi-ring bi-ring-inner bi-ring-a-inner"
                            cx="150" cy="150" r="120"
                            fill="none" stroke="#f3aaff" strokeWidth="2.5" strokeLinecap="round"
                            pathLength="1"
                        />
                        {/* Team initials inside ring */}
                        <text
                            className="bi-ring-initials"
                            x="150" y="163"
                            textAnchor="middle"
                            fill="#e040fb"
                            fontSize="52"
                            fontWeight="900"
                            fontFamily="'Inter', sans-serif"
                            letterSpacing="3"
                            filter="url(#bi-glow-a)"
                        >
                            {initials(teamA)}
                        </text>
                    </svg>

                    {/* Team name below ring */}
                    <div className="bi-team-label bi-label-a">
                        <span className="bi-team-name">{teamA}</span>
                        <span className="bi-team-tag">TEAM A</span>
                    </div>

                    {/* "READY" pill */}
                    <div className="bi-ready-pill bi-ready-a">⚔ READY</div>
                </div>

                {/* ──── VS CENTER ──── */}
                <div className="bi-vs-center">
                    {/* Spark arcs across the center divider */}
                    <svg className="bi-sparks-svg" viewBox="0 0 120 500" preserveAspectRatio="none">
                        <defs>
                            <filter id="bi-spark-glow">
                                <feGaussianBlur stdDeviation="3" result="blur"/>
                                <feMerge>
                                    <feMergeNode in="blur"/>
                                    <feMergeNode in="SourceGraphic"/>
                                </feMerge>
                            </filter>
                        </defs>
                        {sparks.map((s, i) => (
                            <line
                                key={i}
                                className="bi-spark-arc"
                                x1="0" y1={`${s.y}%`}
                                x2="120" y2={`${s.y + ((i%3)-1)*8}%`}
                                stroke={i % 2 ? '#e040fb' : '#00c8ff'}
                                strokeWidth="1"
                                filter="url(#bi-spark-glow)"
                                style={{
                                    animationDelay:    `${s.del}s`,
                                    animationDuration: `${s.dur}s`,
                                }}
                            />
                        ))}
                    </svg>

                    {/* Vertical divider line */}
                    <div className="bi-divider-line" />

                    {/* VS block */}
                    <div className="bi-vs-block">
                        <svg className="bi-vs-svg" viewBox="0 0 120 120">
                            <defs>
                                <filter id="bi-glow-vs" x="-80%" y="-80%" width="260%" height="260%">
                                    <feGaussianBlur stdDeviation="8" result="blur1"/>
                                    <feGaussianBlur stdDeviation="18" result="blur2"/>
                                    <feMerge>
                                        <feMergeNode in="blur2"/>
                                        <feMergeNode in="blur1"/>
                                        <feMergeNode in="SourceGraphic"/>
                                    </feMerge>
                                </filter>
                                <linearGradient id="bi-vs-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%"   stopColor="#e040fb"/>
                                    <stop offset="50%"  stopColor="#ffffff"/>
                                    <stop offset="100%" stopColor="#00c8ff"/>
                                </linearGradient>
                            </defs>
                            {/* Slash line */}
                            <path className="bi-vs-slash"
                                d="M 80 15 L 40 105"
                                stroke="white"
                                strokeWidth="3"
                                strokeLinecap="round"
                                fill="none"
                                pathLength="1"
                                filter="url(#bi-glow-vs)"
                            />
                        </svg>
                        <div className="bi-vs-text">
                            <span className="bi-v">V</span>
                            <span className="bi-s">S</span>
                        </div>
                    </div>
                </div>

                {/* ──── TEAM B ──── */}
                <div className="bi-team-pod bi-pod-b">
                    <div className="bi-pod-glow bi-pod-glow-b" />

                    {/* Neon ring */}
                    <svg className="bi-ring-svg" viewBox="0 0 300 300">
                        <defs>
                            <filter id="bi-glow-b" x="-50%" y="-50%" width="200%" height="200%">
                                <feGaussianBlur stdDeviation="6" result="blur1"/>
                                <feGaussianBlur stdDeviation="14" result="blur2"/>
                                <feMerge>
                                    <feMergeNode in="blur2"/>
                                    <feMergeNode in="blur1"/>
                                    <feMergeNode in="SourceGraphic"/>
                                </feMerge>
                            </filter>
                        </defs>
                        {/* Outer glow ring */}
                        <circle className="bi-ring bi-ring-outer bi-ring-b-outer"
                            cx="150" cy="150" r="128"
                            fill="none" stroke="#00c8ff" strokeWidth="8" strokeLinecap="round"
                            pathLength="1"
                            filter="url(#bi-glow-b)"
                        />
                        {/* Sharp inner ring */}
                        <circle className="bi-ring bi-ring-inner bi-ring-b-inner"
                            cx="150" cy="150" r="120"
                            fill="none" stroke="#a0eeff" strokeWidth="2.5" strokeLinecap="round"
                            pathLength="1"
                        />
                        {/* Team initials inside ring */}
                        <text
                            className="bi-ring-initials"
                            x="150" y="163"
                            textAnchor="middle"
                            fill="#00c8ff"
                            fontSize="52"
                            fontWeight="900"
                            fontFamily="'Inter', sans-serif"
                            letterSpacing="3"
                            filter="url(#bi-glow-b)"
                        >
                            {initials(teamB)}
                        </text>
                    </svg>

                    {/* Team name below ring */}
                    <div className="bi-team-label bi-label-b">
                        <span className="bi-team-name">{teamB}</span>
                        <span className="bi-team-tag">TEAM B</span>
                    </div>

                    {/* "READY" pill */}
                    <div className="bi-ready-pill bi-ready-b">⚔ READY</div>
                </div>

            </div>

            {/* ── "BATTLE START!" banner ─── */}
            <div className={`bi-battle-banner ${phase === 'burst' || phase === 'exiting' ? 'bi-banner-show' : ''}`}>
                <span className="bi-banner-text">BATTLE START!</span>
                <div className="bi-banner-underline" />
            </div>

            {/* ── Flash overlay ─── */}
            <div className={`bi-flash ${phase === 'burst' ? 'bi-flash-active' : ''}`} />
        </div>
    );
}
