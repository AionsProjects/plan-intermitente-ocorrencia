import { Route, Routes } from "react-router-dom"

import { AuroraBackground } from "@/components/AuroraBackground"
import { NavCluster } from "@/components/NavCluster"
import { NavProvider } from "@/components/NavContext"
import { PageTransition } from "@/components/PageTransition"
import { RequireAuth } from "@/components/RequireAuth"
import { RequireRole } from "@/components/RequireRole"
import { LoginPage } from "@/features/auth/LoginPage"
import { CompletarCadastroPage } from "@/features/auth/CompletarCadastroPage"
import { ConfigOverlay } from "@/features/config/ConfigOverlay"
import { AtestadosPage } from "@/features/atestados/AtestadosPage"
import { ConvocarPage } from "@/features/convocar/ConvocarPage"
import { CorrecaoPage } from "@/features/correcao/CorrecaoPage"
import { DescontosPage } from "@/features/descontos/DescontosPage"
import { HubPage } from "@/features/hub/HubPage"
import { TestePage } from "@/features/hub/TestePage"
import { PreencherPage } from "@/features/preencher/PreencherPage"
import { PontoFacultativoPage } from "@/features/ponto-facultativo/PontoFacultativoPage"
import { TestePontoFacultativoPage } from "@/features/ponto-facultativo/TestePontoFacultativoPage"
import { MensalPage } from "@/features/mensal/MensalPage"

function App() {
  return (
    <NavProvider>
      <AuroraBackground />
      <PageTransition
        renderRoutes={(location) => (
          <Routes location={location}>
            {/* Publicas — acesso por link UUID, sem login */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/completar-cadastro" element={<CompletarCadastroPage />} />
            <Route path="/preencher/:uuid" element={<PreencherPage />} />
            <Route path="/descontos/:uuid" element={<DescontosPage />} />
            {/* Operador — exigem login */}
            <Route element={<RequireAuth />}>
              <Route path="/" element={<HubPage />} />
              <Route path="/teste" element={<TestePage />} />
              <Route path="/corrigir" element={<CorrecaoPage />} />
              <Route path="/convocar" element={<ConvocarPage />} />
              <Route path="/atestados" element={<AtestadosPage />} />
              {/* Ponto facultativo — só DP + Admin */}
              <Route element={<RequireRole nivelMinimo="dp" />}>
                <Route path="/ponto-facultativo" element={<PontoFacultativoPage />} />
                <Route path="/teste/ponto-facultativo" element={<TestePontoFacultativoPage />} />
                <Route path="/mensal" element={<MensalPage />} />
              </Route>
            </Route>
          </Routes>
        )}
      />
      {/* Globais — fora do PageTransition (persistem entre rotas) */}
      <NavCluster />
      <ConfigOverlay />
    </NavProvider>
  )
}

export default App
