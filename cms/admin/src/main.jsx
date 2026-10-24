import React, { lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { Empty } from './components/kit';
import { UiProvider } from './lib/ui';
import { AuthProvider, useAuth } from './lib/auth';
import { NotificationsProvider } from './lib/notifications';
import { ForcePasswordScreen, LoginScreen, SetupScreen } from './pages/Login';
import Dashboard from './pages/Dashboard';
// Sections are separate chunks, downloaded the first time a section is opened.
const named = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const loadLocations = () => import('./pages/Locations');
const Bookings = lazy(() => import('./pages/Bookings'));
const BookingDetail = lazy(() => import('./pages/BookingDetail'));
const Profiles = lazy(() => import('./pages/Profiles'));
const ProfileEditor = lazy(() => import('./pages/ProfileEditor'));
const ProfileUpdates = lazy(() => import('./pages/ProfileUpdates'));
const Members = lazy(() => import('./pages/Members'));
const MemberDetail = lazy(() => import('./pages/MemberDetail'));
const Locations = lazy(loadLocations);
const LocationEditor = named(loadLocations, 'LocationEditor');
const Vip = lazy(() => import('./pages/Vip'));
const Content = lazy(() => import('./pages/Content'));
const ContentEditor = lazy(() => import('./pages/ContentEditor'));
const PostEditor = lazy(() => import('./pages/PostEditor'));
const Seo = lazy(() => import('./pages/Seo'));
const Inquiries = lazy(() => import('./pages/Inquiries'));
const Settings = lazy(() => import('./pages/Settings'));
const Users = lazy(() => import('./pages/Users'));
const Roles = lazy(() => import('./pages/Roles'));
const AuditTrail = lazy(() => import('./pages/AuditTrail'));
const Notifications = lazy(() => import('./pages/Notifications'));
import './styles.css';

// Pages a role can't view show a notice instead (the API refuses the data anyway).
function Guard({ module, level = 'view', children }) {
  const { can, user } = useAuth();
  if (can(module, level)) return children;
  return <Empty icon="🔒" title="No access" text={`Your role (${user.role}) doesn’t include this${level === 'manage' ? ' action' : ' section'}. Ask an administrator if you need it.`} />;
}

const g = (module, el, level) => <Guard module={module} level={level}>{el}</Guard>;

function App() {
  const { loading, user, setup, error, refresh } = useAuth();
  if (loading) return <div className="auth-loading">Loading…</div>;
  if (error && !setup) return <div className="auth-loading"><div><p>Can’t reach the API: {error}</p><button className="btn btn-primary" onClick={refresh}>Retry</button></div></div>;
  if (setup?.needed) return <SetupScreen />;
  if (!user) return <LoginScreen />;
  if (user.mustChangePassword) return <ForcePasswordScreen />;
  return (
    <UiProvider>
      <NotificationsProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="/bookings" element={g('bookings', <Bookings />)} />
            <Route path="/bookings/:id" element={g('bookings', <BookingDetail />)} />
            <Route path="/profiles" element={g('profiles', <Profiles />)} />
            <Route path="/profiles/new" element={g('profiles', <ProfileEditor />, 'manage')} />
            <Route path="/profiles/:id" element={g('profiles', <ProfileEditor />)} />
            <Route path="/profile-updates" element={g('profiles', <ProfileUpdates />)} />
            <Route path="/members" element={g('members', <Members />)} />
            <Route path="/members/:id" element={g('members', <MemberDetail />)} />
            <Route path="/locations" element={g('locations', <Locations />)} />
            <Route path="/locations/new" element={g('locations', <LocationEditor />, 'manage')} />
            <Route path="/locations/:id" element={g('locations', <LocationEditor />)} />
            <Route path="/vip" element={g('vip', <Vip />)} />
            <Route path="/content" element={g('content', <Content />)} />
            <Route path="/content/pages/new" element={g('content', <ContentEditor />, 'manage')} />
            <Route path="/content/pages/:id" element={g('content', <ContentEditor />)} />
            <Route path="/content/posts/new" element={g('content', <PostEditor />, 'manage')} />
            <Route path="/content/posts/:id" element={g('content', <PostEditor />)} />
            <Route path="/seo" element={g('seo', <Seo />)} />
            <Route path="/inquiries" element={g('inquiries', <Inquiries />)} />
            <Route path="/settings" element={g('settings', <Settings />)} />
            <Route path="/users" element={g('users', <Users />)} />
            <Route path="/roles" element={g('users', <Roles />)} />
            <Route path="/audit" element={g('audit', <AuditTrail />)} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </NotificationsProvider>
    </UiProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
