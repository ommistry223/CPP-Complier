import { Link, useLocation } from 'react-router-dom';
import { Code2, Swords } from 'lucide-react';
import './Navbar.css';

const Navbar = () => {  // navigate not used here — Admin/Lobby handle their own routing
    const { pathname } = useLocation();
    return (
        <nav className="navbar glass-panel">
            <div className="nav-container">
                <Link to="/" className="nav-brand">
                    <Code2 className="brand-icon" size={28} />
                    <span className="gradient-text brand-text">CodeRunner</span>
                </Link>
                <div className="nav-links">
                    <Link to="/" className={`nav-link ${pathname === '/' ? 'active' : ''}`}>
                        <Swords size={16} /> Join Arena
                    </Link>
                </div>
            </div>
        </nav>
    );
};

export default Navbar;
