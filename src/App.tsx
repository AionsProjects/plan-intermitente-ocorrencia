import { Route, Routes } from "react-router-dom"

import { AuroraBackground } from "@/components/AuroraBackground"
import { PageTransition } from "@/components/PageTransition"
import { AtestadosPage } from "@/features/atestados/AtestadosPage"
import { ConvocarPage } from "@/features/convocar/ConvocarPage"
import { CorrecaoPage } from "@/features/correcao/CorrecaoPage"
import { DescontosPage } from "@/features/descontos/DescontosPage"
import { HubPage } from "@/features/hub/HubPage"
import { TestePage } from "@/features/hub/TestePage"
import { PreencherPage } from "@/features/preencher/PreencherPage"
import { PontoFacultativoPage } from "@/features/ponto-facultativo/PontoFacultativoPage"
import { TestePontoFacultativoPage } from "@/features/ponto-facultativo/TestePontoFacultativoPage"

function App() {
  return (
    <>
      <AuroraBackground />
      <PageTransition
        renderRoutes={(location) => (
          <Routes location={location}>
            <Route path="/" element={<HubPage />} />
            <Route path="/teste" element={<TestePage />} />
            <Route path="/preencher/:uuid" element={<PreencherPage />} />
            <Route path="/corrigir" element={<CorrecaoPage />} />
            <Route path="/convocar" element={<ConvocarPage />} />
            <Route path="/atestados" element={<AtestadosPage />} />
            <Route path="/ponto-facultativo" element={<PontoFacultativoPage />} />
            <Route path="/teste/ponto-facultativo" element={<TestePontoFacultativoPage />} />
            <Route path="/descontos/:uuid" element={<DescontosPage />} />
          </Routes>
        )}
      />
    </>
  )
}

export default App
