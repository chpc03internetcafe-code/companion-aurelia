import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import AgeGate from './components/AgeGate';
import { PageSkeleton, ScrollToTop, Toasts } from './components/Common';
import Home from './pages/Home';

// Every page except the homepage is its own chunk, downloaded the first time it's visited.
const named = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const loadDirectory = () => import('./pages/Directory');
const loadLocations = () => import('./pages/Locations');
const loadGuides = () => import('./pages/Guides');
const Directory = lazy(loadDirectory);
const CategoryPage = named(loadDirectory, 'CategoryPage');
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const Book = lazy(() => import('./pages/Book'));
const BookingStatus = lazy(() => import('./pages/BookingStatus'));
const Locations = lazy(loadLocations);
const LocationPage = named(loadLocations, 'LocationPage');
const Guides = lazy(loadGuides);
const GuidePage = named(loadGuides, 'GuidePage');
const Favorites = lazy(() => import('./pages/Favorites'));
const FAQ = lazy(() => import('./pages/FAQ'));
const Contact = lazy(() => import('./pages/Contact'));
const ContentPage = lazy(() => import('./pages/ContentPage'));
const NotFound = lazy(() => import('./pages/NotFound'));
const LiveChat = lazy(() => import('./components/LiveChat'));

export default function App() {
  return (
    <>
      <ScrollToTop />
      <a href="#main" className="skip-link">Skip to content</a>
      <Header />
      <main id="main">
        <Suspense fallback={<PageSkeleton />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/companions" element={<Directory />} />
            <Route path="/companions/:slug" element={<ProfilePage />} />
            <Route path="/book/:slug" element={<Book />} />
            <Route path="/booking-status" element={<BookingStatus />} />
            <Route path="/booking-status/:ref" element={<BookingStatus />} />
            <Route path="/locations" element={<Locations />} />
            <Route path="/locations/:slug" element={<LocationPage />} />
            <Route path="/guides" element={<Guides />} />
            <Route path="/guides/:slug" element={<GuidePage />} />
            {/* the member account, VIP and companion portal pages were removed; old links go to the homepage */}
            {['/vip', '/account/*', '/companion/*'].map((path) => <Route key={path} path={path} element={<Navigate to="/" replace />} />)}
            <Route path="/favorites" element={<Favorites />} />
            <Route path="/faq" element={<FAQ />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/pages/:slug" element={<ContentPage />} />
            <Route path="/:category" element={<CategoryPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
      <AgeGate />
      <Suspense fallback={null}><LiveChat /></Suspense>
      <Toasts />
    </>
  );
}
