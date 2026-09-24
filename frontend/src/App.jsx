import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

import Watermark from './components/Watermark';
import Layout from './components/Layout/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import MySite from './pages/MySite';
import Sites from './pages/Sites';
import SiteDetail from './pages/SiteDetail';
import MapPage from './pages/MapPage';
import Alerts from './pages/Alerts';
import Complaints from './pages/Complaints';
import Services from './pages/Services';
import MyServices from './pages/MyServices';
import Reports from './pages/Reports';
import AddSite from './pages/AddSite';
import Parameters from './pages/Parameters';
import Users from './pages/Users';
import Security from './pages/Security';
import Account from './pages/Account';
import Live from './pages/Live';

import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';
import { ThemeProvider } from './context/ThemeContext';

function Protected({ children, roles }) {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(session.role)) {
    const home = session.role === 'industry' ? '/mysite' : '/';
    return <Navigate to={home} replace />;
  }
  return children;
}

function Shell() {
  const { session } = useAuth();

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const homePath = session.role === 'industry' ? '/mysite' : '/';

  return (
    <Routes>
      <Route path="/login" element={<Navigate to={homePath} replace />} />
      <Route path="/" element={<Layout />}>
        <Route
          index
          element={
            session.role === 'industry' ? (
              <Navigate to="/mysite" replace />
            ) : (
              <Dashboard />
            )
          }
        />

        {/* Shared (admin, engineer, sales) */}
        <Route
          path="sites"
          element={
            <Protected roles={['admin', 'engineer', 'sales']}>
              <Sites />
            </Protected>
          }
        />
        <Route
          path="sites/:id"
          element={
            <Protected>
              <SiteDetail />
            </Protected>
          }
        />
        <Route
          path="map"
          element={
            <Protected roles={['admin', 'engineer', 'sales']}>
              <MapPage />
            </Protected>
          }
        />
        <Route
          path="alerts"
          element={
            <Protected roles={['admin', 'engineer', 'sales']}>
              <Alerts />
            </Protected>
          }
        />

        {/* Industry routes */}
        <Route
          path="mysite"
          element={
            <Protected roles={['industry']}>
              <MySite />
            </Protected>
          }
        />
        <Route
          path="myalerts"
          element={
            <Protected roles={['industry']}>
              <Alerts mine />
            </Protected>
          }
        />
        <Route
          path="mycomplaints"
          element={
            <Protected roles={['industry']}>
              <Complaints mine />
            </Protected>
          }
        />
        <Route
          path="myservices"
          element={
            <Protected roles={['industry']}>
              <MyServices />
            </Protected>
          }
        />
        <Route
          path="account"
          element={
            <Protected roles={['industry']}>
              <Account />
            </Protected>
          }
        />

        {/* Shared across all authenticated roles */}
        <Route
          path="complaints"
          element={
            <Protected roles={['admin', 'engineer', 'sales']}>
              <Complaints />
            </Protected>
          }
        />
        <Route
          path="services"
          element={
            <Protected roles={['admin', 'engineer', 'sales']}>
              <Services />
            </Protected>
          }
        />
        <Route
          path="reports"
          element={
            <Protected roles={['admin', 'engineer', 'industry']}>
              <Reports />
            </Protected>
          }
        />

        {/* Admin / Engineer only */}
        <Route
          path="addsite"
          element={
            <Protected roles={['admin', 'engineer']}>
              <AddSite />
            </Protected>
          }
        />
        <Route
          path="params"
          element={
            <Protected roles={['admin']}>
              <Parameters />
            </Protected>
          }
        />
        <Route
          path="users"
          element={
            <Protected roles={['admin']}>
              <Users />
            </Protected>
          }
        />
        <Route
          path="security"
          element={
            <Protected roles={['admin']}>
              <Security />
            </Protected>
          }
        />

        <Route
  path="live"
  element={
    <Protected roles={['admin']}>
      <Live />
    </Protected>
  }
/>

        <Route path="*" element={<Navigate to={homePath} replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <DataProvider>
          <Watermark />
          <Shell />
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: 'var(--surface)',
                color: 'var(--ink)',
                border: '1px solid var(--border)',
                fontSize: 13,
                fontWeight: 500,
              },
              success: { iconTheme: { primary: '#10b981', secondary: '#fff' } },
              error:   { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
            }}
          />
        </DataProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}