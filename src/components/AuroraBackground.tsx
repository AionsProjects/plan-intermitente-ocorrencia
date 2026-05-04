export function AuroraBackground() {
  return (
    <>
      {/* Filtro SVG global pra distorção tipo lente/liquid glass.
          Referenciado em CSS via backdrop-filter: url(#liquid-glass) */}
      <svg
        aria-hidden
        style={{ position: "absolute", width: 0, height: 0, pointerEvents: "none" }}
      >
        <defs>
          <filter id="liquid-glass" x="-15%" y="-15%" width="130%" height="130%">
            {/* Frequência baixa = ondas longas e suaves (não ruído alto-frequência).
                Resultado: distorção mais coerente, parece curvatura de lente
                real em vez de ruído aleatório. */}
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.005 0.007"
              numOctaves="1"
              seed="3"
              result="turb"
            />
            <feGaussianBlur in="turb" stdDeviation="4" result="softTurb" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="softTurb"
              scale="35"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
          {/* Versão suave pra elementos menores (tiles, botões, banners):
              deslocamento bem menor pra não distorcer demais em alturas pequenas. */}
          <filter id="liquid-glass-soft" x="-15%" y="-15%" width="130%" height="130%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.018 0.024"
              numOctaves="2"
              seed="3"
              result="turb"
            />
            <feGaussianBlur in="turb" stdDeviation="1.5" result="softTurb" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="softTurb"
              scale="8"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div
          className="aurora-orb"
          style={{
            width: 540,
            height: 540,
            top: "-130px",
            right: "-90px",
            background:
              "radial-gradient(circle at 30% 30%, #6ea0ff 0%, #2a4fd0 45%, transparent 70%)",
            opacity: 0.38,
            animation: "orb-drift-1 14s ease-in-out infinite",
          }}
        />
      <div
        className="aurora-orb"
        style={{
          width: 460,
          height: 460,
          bottom: "-150px",
          left: "-110px",
          background:
            "radial-gradient(circle at 40% 40%, #f0d28a 0%, #c8943a 50%, transparent 72%)",
          opacity: 0.25,
          animation: "orb-drift-2 18s ease-in-out infinite",
        }}
      />
      <div
        className="aurora-orb"
        style={{
          width: 380,
          height: 380,
          top: "55%",
          right: "10%",
          background:
            "radial-gradient(circle at 50% 50%, #e8c275 0%, #8a6420 55%, transparent 75%)",
          opacity: 0.18,
          animation: "orb-drift-3 22s ease-in-out infinite",
        }}
      />
      <div
        className="aurora-orb"
        style={{
          width: 340,
          height: 340,
          top: "18%",
          left: "8%",
          background:
            "radial-gradient(circle at 50% 50%, #b8c5d6 0%, #5a6b85 55%, transparent 78%)",
          opacity: 0.2,
          animation: "orb-drift-4 20s ease-in-out infinite",
        }}
      />
      </div>
    </>
  )
}
