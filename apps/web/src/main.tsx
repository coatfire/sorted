import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "@fontsource-variable/dm-sans";
import "@fontsource/newsreader/600.css";
import { AppShell } from "./AppShell";
import { Home } from "./pages/Home";
import { Calendar } from "./pages/Calendar";
import { BookingForm } from "./pages/BookingForm";
import { Money } from "./pages/Money";
import { Expenses } from "./pages/Expenses";
import { BookingDetail } from "./pages/BookingDetail";
import { ClientDetail } from "./pages/ClientDetail";
import { Settings } from "./pages/Settings";
import { Login } from "./pages/Login";
import { Signup, Verify, Forgot, Reset, GoogleLogin } from "./pages/Account";
import { StoreProvider } from "./lib/store";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <StoreProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/login/google" element={<GoogleLogin />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/forgot" element={<Forgot />} />
          <Route path="/reset" element={<Reset />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<Home />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/bookings/new" element={<BookingForm />} />
            <Route path="/bookings/:id" element={<BookingDetail />} />
            <Route path="/bookings/:id/edit" element={<BookingForm />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/money" element={<Money />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/welcome" element={<Settings welcome />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </StoreProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
