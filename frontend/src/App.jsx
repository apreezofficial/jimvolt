import GoogleCompletePage from './pages/GoogleCompletePage.jsx';
import { Navigate, Route, Routes } from 'react-router-dom';
import MainLayout from './layouts/MainLayout.jsx';
import AdminLayout from './layouts/AdminLayout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import Home from './pages/Home.jsx';
import AdsPage from './pages/Ads.jsx';
import AdDetailPage from './pages/AdDetailPage.jsx';
import PostAdPage from './pages/PostAdPage.jsx';
import FavouritesPage from './pages/FavouritesPage.jsx';
import RecentlyViewedPage from './pages/RecentlyViewedPage.jsx';
import MessagesPage from './pages/MessagesPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import AdminLoginPage from './pages/AdminLoginPage.jsx';
import AdminDashboardPage from './pages/AdminDashboardPage.jsx';
import AdminWorkspacePage from './pages/AdminWorkspacePage.jsx';
import AdminPromotionPackagesPage from './pages/AdminPromotionPackagesPage.jsx';
import AdminUsersPage from './pages/AdminUsersPage.jsx';
import AdminVerificationsPage from './pages/AdminVerificationsPage.jsx';
import VerifyEmailPage from './pages/VerifyEmailPage.jsx';
import SellersPage from './pages/SellersPage.jsx';
import SellerDetailPage from './pages/SellerDetailPage.jsx';
import SellerStorefrontPage from './pages/SellerStorefrontPage.jsx';
import InformationPage from './pages/InformationPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import AccountSettingsPage from './pages/AccountSettingsPage.jsx';
import Placeholder from './pages/Placeholder.jsx';
import BachsTestPage from './pages/BachsTestPage.jsx';
import SellerSlugPage from './pages/SellerSlugPage.jsx';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/tests/bachs" element={<BachsTestPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/auth/google/complete" element={<GoogleCompletePage />} />
        <Route path="/admin" element={<ProtectedRoute adminOnly><AdminLayout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboardPage />} />
          <Route path="advertisements" element={<AdminPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="users/:id" element={<AdminUsersPage />} />
          <Route path="sellers" element={<AdminWorkspacePage />} />
          <Route path="verifications" element={<AdminVerificationsPage />} />
          <Route path="verifications/:id" element={<AdminVerificationsPage />} />
          <Route path="categories" element={<AdminWorkspacePage />} />
          <Route path="reports" element={<AdminWorkspacePage />} />
          <Route path="payments" element={<AdminWorkspacePage />} />
          <Route path="promotion-packages" element={<AdminPromotionPackagesPage />} />
          <Route path="analytics" element={<AdminWorkspacePage />} />
          <Route path="settings" element={<AdminWorkspacePage />} />
        </Route>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/ads" element={<AdsPage />} />
          <Route path="/search" element={<AdsPage />} />
          <Route path="/ads/:id" element={<AdDetailPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/sellers" element={<SellersPage />} />
          <Route path="/sellers/:id" element={<SellerDetailPage />} />
          <Route path="/seller/:slug" element={<SellerStorefrontPage />} />
          {/* Canonical public profile URLs: /@username */}
          {/* React Router cannot match "@" plus a param in one segment, so match the whole
              segment and let the page accept only handles that start with "@". */}
          <Route path="/:handle" element={<SellerSlugPage />} />
          <Route path="/safety" element={<InformationPage />} />
          <Route path="/contact" element={<InformationPage />} />
          <Route path="/terms" element={<InformationPage />} />
          <Route path="/privacy" element={<InformationPage />} />
          <Route path="/refund-policy" element={<InformationPage />} />
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/dashboard/ads" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/dashboard/analytics" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/dashboard/analytics/:advertisementId" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/dashboard/verification" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/dashboard/notifications" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/dashboard/promotions" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/dashboard/ads/:id/edit" element={<ProtectedRoute><PostAdPage /></ProtectedRoute>} />
          <Route path="/dashboard/business-profile" element={<Navigate to="/dashboard" replace />} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/account-settings" element={<ProtectedRoute><AccountSettingsPage /></ProtectedRoute>} />
          <Route path="/post-ad" element={<ProtectedRoute><PostAdPage /></ProtectedRoute>} />
          <Route path="/saved" element={<FavouritesPage />} />
          <Route path="/favourites" element={<FavouritesPage />} />
          <Route path="/recently-viewed" element={<RecentlyViewedPage />} />
          <Route path="/messages" element={<ProtectedRoute><MessagesPage /></ProtectedRoute>} />
          <Route path="*" element={<Placeholder />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
