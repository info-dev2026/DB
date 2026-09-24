import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import FloatingDock from '../UI/FloatingDock';
import WelcomeModal from '../UI/WelcomeModal';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="app">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="main">
        <TopBar onMenuClick={() => setSidebarOpen((o) => !o)} />
        <div className="content">
          <Outlet />
        </div>
      </div>

      <FloatingDock />
      <WelcomeModal />
    </div>
  );
}