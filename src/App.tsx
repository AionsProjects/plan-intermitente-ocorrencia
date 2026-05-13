import { Route, Routes } from "react-router-dom"

import { AuroraBackground } from "@/components/AuroraBackground"
import { PageTransition } from "@/components/PageTransition"
import { ConvocarPage } from "@/features/convocar/ConvocarPage"
import { CorrecaoPage } from "@/features/correcao/CorrecaoPage"
import { HubPage } from "@/features/hub/HubPage"
import { TestePage } from "@/features/hub/TestePage"
import { PreencherPage } from "@/features/preencher/PreencherPage"

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
          </Routes>
        )}
      />
    </>
  )
}

export default App
