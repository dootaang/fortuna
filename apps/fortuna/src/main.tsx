import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Navigate, createBrowserRouter, RouterProvider } from "react-router";
import "./styles.css";
import { ToastProvider } from "./ui/kit.tsx";
import { PlayerRoot } from "./pages/PlayerRoot.tsx";
import { RouteError } from "./pages/RouteError.tsx";
import { installSound } from "./fx/sound.ts";

installSound();

const page = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({ Component: (await load()).default });

const router = createBrowserRouter([
  { path: "/dealer/*", errorElement: <RouteError />, lazy: page(() => import("./dealer/DealerApp.tsx")) },
  {
    path: "/",
    element: <PlayerRoot />,
    errorElement: <RouteError />,
    children: [
      { index: true, lazy: page(() => import("./pages/HomePage.tsx")) },
      { path: "city", lazy: page(() => import("./city/CityPage.tsx")) },
      { path: "work", lazy: page(() => import("./pages/WorkHub.tsx")) },
      { path: "work/:template", lazy: page(() => import("./work/WorkShift.tsx")) },
      { path: "alley", lazy: page(() => import("./pages/AlleyPage.tsx")) },
      { path: "house", lazy: page(() => import("./pages/HousePage.tsx")) },
      { path: "table/:venue/:game", lazy: page(() => import("./games/TablePage.tsx")) },
      { path: "market", lazy: page(() => import("./market/MarketPage.tsx")) },
      { path: "market/info", lazy: page(() => import("./market/InfoPage.tsx")) },
      { path: "market/:coin", lazy: page(() => import("./market/CoinPage.tsx")) },
      { path: "skills", lazy: page(() => import("./pages/SkillsPage.tsx")) },
      { path: "pvp/:roomId", lazy: page(() => import("./pvp/PvpRoomPage.tsx")) },
      { path: "shop", lazy: page(() => import("./pages/ShopPage.tsx")) },
      // 예전 지갑 화면은 홈으로 합쳐졌다.
      { path: "wallet", element: <Navigate to="/" replace /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  </StrictMode>,
);
