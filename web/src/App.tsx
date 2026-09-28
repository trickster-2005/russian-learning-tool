import { HashRouter, Route, Routes } from "react-router-dom";
import { I18nProvider } from "./i18n";
import { SettingsProvider } from "./lib/settings";
import TopBar from "./components/TopBar";
import HomePage from "./pages/HomePage";
import FamilyPage from "./pages/FamilyPage";
import BrowsePage from "./pages/BrowsePage";
import AboutPage from "./pages/AboutPage";

export default function App() {
  return (
    <I18nProvider>
      <SettingsProvider>
        <HashRouter>
          <div className="app">
            <TopBar />
            <main id="main" className="main" tabIndex={-1}>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/family/:id" element={<FamilyPage />} />
                <Route path="/browse" element={<BrowsePage />} />
                <Route path="/about" element={<AboutPage />} />
                <Route path="*" element={<HomePage />} />
              </Routes>
            </main>
          </div>
        </HashRouter>
      </SettingsProvider>
    </I18nProvider>
  );
}
