import { Route, Routes } from "react-router-dom"

import { AuroraBackground } from "@/components/AuroraBackground"
import { FundoTematico } from "@/components/FundoTematico"
import { NavCluster } from "@/components/NavCluster"
import { NavProvider } from "@/components/NavContext"
import { PageTransition } from "@/components/PageTransition"
import { ZoomProvider } from "@/components/ZoomTransition"
import { RequireAuth } from "@/components/RequireAuth"
import { RequireRole } from "@/components/RequireRole"
import { LoginPage } from "@/features/auth/LoginPage"
import { CompletarCadastroPage } from "@/features/auth/CompletarCadastroPage"
import { ConfigOverlay } from "@/features/config/ConfigOverlay"
import { AtividadePage } from "@/features/atividade/AtividadePage"
import { RedirParaExec } from "@/features/atividade/RedirParaExec"
import { NaoEncontradaPage } from "@/features/hub/NaoEncontradaPage"
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
    <ZoomProvider>
    <NavProvider>
      <AuroraBackground />
      <FundoTematico />
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
              {/* Histórico de execuções. RequireAuth e NÃO RequireRole "dp":
                  operacional/RH precisa do próprio histórico, e o 403 por linha vem
                  do servidor, que é o único lugar que não se contorna.
                  `/atividade/:id` é só alias do deep link -> ?exec= */}
              <Route path="/atividade" element={<AtividadePage />} />
              <Route path="/atividade/:id" element={<RedirParaExec />} />
              {/* Ponto facultativo — só DP + Admin */}
              <Route element={<RequireRole nivelMinimo="dp" />}>
                <Route path="/ponto-facultativo" element={<PontoFacultativoPage />} />
                <Route path="/teste/ponto-facultativo" element={<TestePontoFacultativoPage />} />
                <Route path="/mensal" element={<MensalPage />} />
              </Route>
            </Route>
            {/* Coringa: sem isto, URL inexistente renderizava área em branco e — pior —
                sem redirect de login, porque RequireAuth só vale em rota declarada. */}
            <Route path="*" element={<NaoEncontradaPage />} />
          </Routes>
        )}
      />
      {/* Globais — fora do PageTransition (persistem entre rotas) */}
      <NavCluster />
      <ConfigOverlay />
    </NavProvider>
    </ZoomProvider>
  )
}

export default App
