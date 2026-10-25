import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "./index.css";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import GameDetail from "./pages/GameDetail";
import TrackRecord from "./pages/TrackRecord";
import HowItWorks from "./pages/HowItWorks";
import { Responsible, Terms, Privacy } from "./pages/Legal";
import NotFound from "./pages/NotFound";
import Faq from "./pages/Faq";
import AgeGate from "./components/AgeGate";
import SubscribePage from "./pages/Subscribe";
import Account from "./pages/Account";
import Contact from "./pages/Contact";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AgeGate>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="game/:id" element={<GameDetail />} />
          <Route path="games/:date/:slug" element={<GameDetail />} />
          <Route path="track-record" element={<TrackRecord />} />
          <Route path="how-it-works" element={<HowItWorks />} />
          <Route path="responsible-gaming" element={<Responsible />} />
          <Route path="terms" element={<Terms />} />
          <Route path="privacy" element={<Privacy />} />
          <Route path="faq" element={<Faq />} />
          <Route path="subscribe" element={<SubscribePage />} />
          <Route path="account" element={<Account />} />
          <Route path="contact" element={<Contact />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
    </AgeGate>
  </React.StrictMode>
);
