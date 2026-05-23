export function AuroraBackground() {
  return (
    <>
      {/* Filtro SVG global pra distorÃ§Ã£o tipo lente/liquid glass.
          Referenciado em CSS via backdrop-filter: url(#liquid-glass) */}
      <svg
        aria-hidden
        style={{ position: "absolute", width: 0, height: 0, pointerEvents: "none" }}
      >
        <defs>
          <filter id="liquid-glass" x="-15%" y="-15%" width="130%" height="130%">
            {/* FrequÃªncia baixa = ondas longas e suaves (nÃ£o ruÃ­do alto-frequÃªncia).
                Resultado: distorÃ§Ã£o mais coerente, parece curvatura de lente
                real em vez de ruÃ­do aleatÃ³rio. */}
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
          {/* VersÃ£o suave pra elementos menores (tiles, botÃµes, banners):
              deslocamento bem menor pra nÃ£o distorcer demais em alturas pequenas. */}
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
              "radial-gradient(circle at 30% 30%, #5f86ff 0%, #18338c 48%, transparent 72%)",
            opacity: 0.24,
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
            "radial-gradient(circle at 40% 40%, #d8aa53 0%, #6f4817 52%, transparent 74%)",
          opacity: 0.16,
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
            "radial-gradient(circle at 50% 50%, #bd8f3d 0%, #503313 55%, transparent 76%)",
          opacity: 0.12,
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
            "radial-gradient(circle at 50% 50%, #7688a3 0%, #25324a 56%, transparent 78%)",
          opacity: 0.13,
          animation: "orb-drift-4 20s ease-in-out infinite",
        }}
      />
      </div>
    </>
  )
}

