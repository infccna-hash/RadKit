import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { AuthProvider, useAuth, homeFor } from './lib/auth.jsx';
import { ToastProvider, PageLoader } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import SharePage from './pages/SharePage.jsx';
import PrintReport from './pages/PrintReport.jsx';
import Worklist from './pages/rad/Worklist.jsx';
import RadUpload from './pages/rad/Upload.jsx';
import Patients from './pages/rad/Patients.jsx';
import PatientDetail from './pages/rad/PatientDetail.jsx';
import StudyDetail from './pages/rad/StudyDetail.jsx';
import Shares from './pages/rad/Shares.jsx';
import Clients from './pages/rad/Clients.jsx';
import ClientHome from './pages/client/ClientHome.jsx';
import ClientUpload from './pages/client/ClientUpload.jsx';
import ClientStudy from './pages/client/ClientStudy.jsx';
import ClientHistory from './pages/client/ClientHistory.jsx';
import AdminUsers from './pages/admin/Users.jsx';
import { StudyViewerPage, ShareViewerPage, ResolveViewerPage } from './pages/ViewerPage.jsx';

function Guard({ role, children }) {
  const { user } = useAuth();
  if (user === undefined) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/password" replace />;
  if (role && user.role !== role) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

function Root() {
  const { user } = useAuth();
  if (user === undefined) return <PageLoader />;
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Root />} />
      <Route path="/login" element={<Login />} />
      <Route path="/password" element={<ChangePassword />} />
      <Route path="/s/:token" element={<SharePage />} />
      <Route path="/s/:token/view" element={<ShareViewerPage />} />
      <Route path="/viewer/uid/:uid" element={<ResolveViewerPage />} />
      <Route path="/viewer/:id" element={<Guard><StudyViewerPage /></Guard>} />
      <Route path="/print/:id" element={<Guard><PrintReport /></Guard>} />

      <Route path="/app" element={<Guard role="radiologist"><Layout /></Guard>}>
        <Route index element={<Worklist />} />
        <Route path="upload" element={<RadUpload />} />
        <Route path="patients" element={<Patients />} />
        <Route path="patients/:id" element={<PatientDetail />} />
        <Route path="studies/:id" element={<StudyDetail />} />
        <Route path="shares" element={<Shares />} />
        <Route path="clients" element={<Clients />} />
      </Route>

      <Route path="/client" element={<Guard role="client"><Layout /></Guard>}>
        <Route index element={<ClientHome />} />
        <Route path="upload" element={<ClientUpload />} />
        <Route path="studies/:id" element={<ClientStudy />} />
        <Route path="history" element={<ClientHistory />} />
      </Route>

      <Route path="/admin" element={<Guard role="admin"><Layout /></Guard>}>
        <Route index element={<AdminUsers />} />
      </Route>

      <Route path="*" element={<Root />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
