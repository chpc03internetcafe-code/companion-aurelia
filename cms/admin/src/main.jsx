import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { Empty } from './components/kit';
import { UiProvider } from './lib/ui';
import { AuthProvider, useAuth } from './lib/auth';
import { NotificationsProvider } from './lib/notifications';
import { ForcePasswordScreen, LoginScreen, SetupScreen } from './pages/Login';
import Dashboard from './pages/Dashboard';
import Bookings from './pages/Bookings';
import BookingDetail from './pages/BookingDetail';
import Profiles from './pages/Profiles';
import ProfileEditor from './pages/ProfileEditor';
import ProfileUpdates from './pages/ProfileUpdates';
import Members from './pages/Members';
import MemberDetail from './pages/MemberDetail';
import Locations, { LocationEditor } from './pages/Locations';
import Vip from './pages/Vip';
import Content from './pages/Content';
import ContentEditor from './pages/ContentEditor';
import PostEditor from './pages/PostEditor';
import Seo from './pages/Seo';
import Inquiries from './pages/Inquiries';
import Settings from './pages/Settings';
import Users from './pages/Users';
import Roles from './pages/Roles';
import AuditTrail from './pages/AuditTrail';
import Notifications from './pages/Notifications';
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
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
