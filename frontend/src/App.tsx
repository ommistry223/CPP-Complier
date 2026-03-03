import { useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Navbar from './components/layout/Navbar';
import Lobby from './pages/Lobby';
import Game from './pages/Game';
import Admin from './pages/Admin';
import Compiler from './pages/Compiler';
import Leaderboard from './pages/Leaderboard';
import AdminDashboard from './pages/AdminDashboard';
import LoadingScreen from './components/LoadingScreen';

function AppInner() {
  const { pathname } = useLocation();
  const hideNav = pathname === '/admin_panel' || pathname === '/game' || pathname.startsWith('/leaderboard') || pathname === '/dashboard';
  return (
    <div className="app-container">
      {!hideNav && <Navbar />}
      <main className={hideNav ? 'main-content-full' : 'main-content'}>
        <Routes>
          <Route path="/" element={<Lobby />} />
          <Route path="/game" element={<Game />} />
          <Route path="/admin_panel" element={<Admin />} />
          <Route path="/compiler" element={<Compiler />} />
          <Route path="/leaderboard/:tournamentId" element={<Leaderboard />} />
          <Route path="/dashboard" element={<AdminDashboard />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  const [loading, setLoading] = useState(true);
  const handleDone = useCallback(() => setLoading(false), []);

  return (
    <>
      {loading && <LoadingScreen onDone={handleDone} />}
      <BrowserRouter>
        <AppInner />
      </BrowserRouter>
    </>
  );
}

export default App;
