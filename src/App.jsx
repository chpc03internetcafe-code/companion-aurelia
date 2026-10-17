import { Route, Routes } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import AgeGate from './components/AgeGate';
import { ScrollToTop, Toasts } from './components/Common';
import Home from './pages/Home';
import Directory, { CategoryPage } from './pages/Directory';
import ProfilePage from './pages/ProfilePage';
import Book from './pages/Book';
import BookingStatus from './pages/BookingStatus';
import Locations, { LocationPage } from './pages/Locations';
import Guides, { GuidePage } from './pages/Guides';
import Vip from './pages/Vip';
import Account from './pages/Account';
import Companion from './pages/Companion';
import Favorites from './pages/Favorites';
import FAQ from './pages/FAQ';
import Contact from './pages/Contact';
import ContentPage from './pages/ContentPage';
import NotFound from './pages/NotFound';

export default function App() {
  return (
    <>
      <ScrollToTop />
      <a href="#main" className="skip-link">Skip to content</a>
      <Header />
      <main id="main">
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
          <Route path="/vip" element={<Vip />} />
          <Route path="/account" element={<Account />} />
          <Route path="/account/:tab" element={<Account />} />
          <Route path="/account/:tab/:slug" element={<Account />} />
          <Route path="/companion" element={<Companion />} />
          <Route path="/companion/:tab" element={<Companion />} />
          <Route path="/companion/:tab/:ref" element={<Companion />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/pages/:slug" element={<ContentPage />} />
          <Route path="/:category" element={<CategoryPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
      <AgeGate />
      <Toasts />
    </>
  );
}
