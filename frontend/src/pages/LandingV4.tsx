// Landing v3 — estructura B2B de infraestructura.
//
// Convive con /v2 (el door-hero scrollytelling) hasta que definamos cuál va.
//
// La arquitectura sigue la convención que un CTO sabe escanear: hero con
// pestañas de producto, grilla de ecosistema, filas alternadas copy/visual,
// declaraciones que rompen el ritmo, FAQ y cierre. Todo dentro de una rejilla
// de hairlines con cruces de registro.
//
// Lo que es NUESTRO y no sale de ninguna referencia:
//   · el aura naranja que late por sección (canvas, animada por tiempo)
//   · la rampa de tintes con el matiz fijo — la razón de que los lavados
//     dejaran de ensuciarse
//   · el picaporte como marcador de sección (§4 del kit)
//   · el acento serif en UNA palabra por pantalla (§3)
//
// Color, tipografía y radios salen de BRAND_KIT.md. Las desviaciones están
// comentadas donde ocurren.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { useProtocolStats } from "@/lib/useProtocolStats";

// ── IDIOMA (ES/EN) ──────────────────────────────────────────────────
// Detección por navegador: es-* → español (LATAM/España); cualquier otra
// región → inglés. El visitante puede forzarlo con el toggle del nav y la
// elección persiste en localStorage.
type Lang = "es" | "en" | "pt";

function detectarIdioma(): Lang {
  try {
    const guardado = localStorage.getItem("lendoor-lang");
    if (guardado === "es" || guardado === "en" || guardado === "pt") return guardado;
    const nav = (navigator.language || "es").toLowerCase();
    if (nav.startsWith("es")) return "es";
    if (nav.startsWith("pt")) return "pt"; // pt-BR: Lemon ya opera en Brasil
    return "en";
  } catch {
    return "es";
  }
}

const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: "es",
  setLang: () => {},
});
const useLang = () => useContext(LangCtx);

// ── PORTUGUÉS (pt-BR) ───────────────────────────────────────────────
// Registro B2B brasileño ("você", bureau, holerite). Indexado por la string
// española de cada par t(es, en).
const PT: Record<string, string> = {
  "Crédito que se puede auditar en vivo": "Crédito que você pode auditar ao vivo",
  "Score en vivo": "Score ao vivo",
  "Límite que crece": "Limite que cresce",
  "Capital incluido": "Capital incluído",
  "Una sola llamada": "Uma única chamada",
  "Ver el vault en vivo →": "Ver o vault ao vivo →",
  "Producto": "Produto",
  "Cómo funciona": "Como funciona",
  "Prueba": "Prova",
  "Solicitar acceso": "Solicitar acesso",
  "Elegí tu lado": "Escolha seu lado",
  "Para fintechs": "Para fintechs",
  "Para suppliers": "Para suppliers",
  "La puerta de Lendoor se abre al scrollear y muestra la mini-app del otro lado":
    "A porta da Lendoor se abre ao rolar e mostra o mini-app do outro lado",
  "Corriendo dentro de Lemon · USDC": "Rodando dentro do Lemon · USDC",
  "Lendoor Score: 457 de 1000": "Lendoor Score: 457 de 1000",
  "de 1000": "de 1000",
  "Historial": "Histórico",
  "Identidad": "Identidade",
  "Préstamos originados": "Empréstimos originados",
  "Repagados a tiempo": "Pagos em dia",
  "Usuarios con línea": "Usuários com linha",
  "Países en producción": "Países em produção",
  "Línea aprobada": "Linha aprovada",
  "Pedir préstamo": "Pedir empréstimo",
  "7 días": "7 dias",
  "14 días": "14 dias",
  "21 días": "21 dias",
  "Devolvés ": "Você devolve ",
  " en un solo pago.": " em um único pagamento.",
  "Confirmar": "Confirmar",
  "USDC en la wallet en segundos": "USDC na wallet em segundos",
  "wallet vinculada ✓": "wallet vinculada ✓",
  "leyendo huella on-chain…": "lendo a pegada on-chain…",
  "límite": "limite",
  "línea abierta — lista para usar": "linha aberta — pronta para usar",
  "wallet conectada ✓": "wallet conectada ✓",
  "depósito confirmado…": "depósito confirmado…",
  "posición on-chain a tu nombre": "posição on-chain no seu nome",
  "el vault ya está prestando": "o vault já está emprestando",
  "Tu línea está lista.": "Sua linha está pronta.",
  "El vault ya está prestando.": "O vault já está emprestando.",
  "Score y límite al instante, apenas conecta la wallet. Sin formularios, sin espera.":
    "Score e limite na hora, assim que a wallet conecta. Sem formulários, sem espera.",
  "Yield real: sale del interés que la gente efectivamente paga, no de emisión de tokens.":
    "Yield real: vem dos juros que as pessoas efetivamente pagam, não de emissão de tokens.",
  "Score": "Score",
  "Límite": "Limite",
  "Préstamos fondeados": "Empréstimos financiados",
  "Tu posición": "Sua posição",
  "de interés cobrado en 30 días.": "de juros recebidos em 30 dias.",
  "Depositaste": "Você depositou",
  "Interés de repagos": "Juros dos pagamentos",
  "Cada repago entra con su interés": "Cada pagamento chega com seus juros",
  "Tres pasos. El orden importa: cada uno depende del anterior.":
    "Três passos. A ordem importa: cada um depende do anterior.",
  "El flujo que ve tu usuario. Dos taps, cero formularios.":
    "O fluxo que o seu usuário vê. Dois toques, zero formulários.",
  "PASO": "PASSO",
  "Acceso": "Acesso",
  "Abrí la puerta en tu app.": "Abra a porta no seu app.",
  "Contanos qué construís y te decimos en la primera llamada si tiene sentido.":
    "Conte o que você está construindo e na primeira call dizemos se faz sentido.",
  "Prueba viva": "Prova viva",
  "Recursos": "Recursos",
  "Contrato verificable": "Contrato verificável",
  "Mini-app en Lemon": "Mini-app no Lemon",
  "Compañía": "Empresa",
  "Contacto": "Contato",
  "Crédito sin colateral para quien el buró nunca miró.":
    "Crédito sem colateral para quem o bureau nunca olhou.",
  "© 2026 Lendoor · Crédito on-chain": "© 2026 Lendoor · Crédito on-chain",
  "Hecho en LATAM": "Feito na LATAM",
  "El score": "O score",
  "Leemos la huella que la persona ya generó: actividad on-chain, volumen de stablecoins, antigüedad de wallet. Con eso devolvemos un límite, sin buró y sin recibo de sueldo.":
    "Lemos a pegada que a pessoa já gerou: atividade on-chain, volume de stablecoins, idade da wallet. Com isso devolvemos um limite, sem bureau e sem holerite.",
  "Cómo se calcula": "Como é calculado",
  "Se recalcula solo": "Recalcula sozinho",
  "Cada repago entra al modelo y mueve el puntaje. El usuario ve el número subir dentro de tu app, sin pedirle nada.":
    "Cada pagamento entra no modelo e move a pontuação. O usuário vê o número subir dentro do seu app, sem pedir nada a ele.",
  "La integración": "A integração",
  "Sin custodia, sin nodos, sin contratos que auditar de tu lado. Pedís la línea y te devolvemos límite y tasa.":
    "Sem custódia, sem nós, sem contratos para auditar do seu lado. Você pede a linha e devolvemos limite e taxa.",
  "Ver la API": "Ver a API",
  "Abrí la línea de un usuario": "Abra a linha de um usuário",
  "Un POST con el id del usuario y su wallet. El SDK trae la pantalla lista, o la diseñás vos con los endpoints.":
    "Um POST com o id do usuário e a wallet. O SDK traz a tela pronta, ou você desenha com os endpoints.",
  "La tesis": "A tese",
  "El historial le pertenece a la ": "O histórico pertence à ",
  "persona": "pessoa",
  ", no al banco.": ", não ao banco.",
  "Cada repago construye un legajo que hoy le abre crédito en tu app, y mañana viaja con ella a otra app y a otro país. Eso es lo que un buró nacional no puede hacer.":
    "Cada pagamento constrói um histórico que hoje abre crédito no seu app, e amanhã viaja com a pessoa para outro app e outro país. Isso é o que um bureau nacional não consegue fazer.",
  "Alcance": "Alcance",
  "Prestar es actividad regulada país por país, así que cada mercado nuevo lleva su tiempo. No vendemos cobertura: vendemos profundidad donde ya estamos.":
    "Emprestar é atividade regulada país a país, então cada novo mercado leva tempo. Não vendemos cobertura: vendemos profundidade onde já estamos.",
  "Hablemos de tu mercado": "Vamos falar do seu mercado",
  "Cuatro países en producción": "Quatro países em produção",
  "Corriendo dentro de Lemon. Cada préstamo y cada repago queda registrado públicamente y lo podés auditar.":
    "Rodando dentro do Lemon. Cada empréstimo e cada pagamento fica registrado publicamente e você pode auditar.",
  "El modelo viene corriendo desde diciembre de 2025, con miles de préstamos originados y repagados.":
    "O modelo não é uma promessa: está rodando em produção com milhares de empréstimos originados e pagos.",
  "Verificalo vos mismo": "Verifique você mesmo",
  "Todo verificable, menos el score": "Tudo verificável, menos o score",
  "Cada préstamo, cada repago y el estado del vault quedan registrados en una blockchain pública. El score no: se calcula en nuestros servidores — lo decimos claro porque un CTO lo va a chequear.":
    "Cada empréstimo, cada pagamento e o estado do vault ficam registrados em uma blockchain pública. O score não: é calculado nos nossos servidores — dizemos com clareza porque um CTO vai checar.",
};

/**
 * t("texto es", "english text") — el par vive junto: imposible desincronizar.
 * El portugués NO es un tercer parámetro (86 call-sites): vive en el
 * diccionario PT, indexado por la string española. Si una key falta (o el
 * copy ES cambió y quedó desincronizada), cae al español — para un lector
 * pt-BR es el fallback más legible.
 */
function traducir(lang: Lang, es: string, en: string) {
  if (lang === "en") return en;
  if (lang === "pt") return PT[es] ?? es;
  return es;
}
function useT() {
  const { lang } = useLang();
  return (es: string, en: string) => traducir(lang, es, en);
}

// ── CADENA ──────────────────────────────────────────────────────────
// La MISMA landing sirve dos deployments sobre cadenas distintas:
// lendoor.xyz (Celo) y stellar.lendoor.xyz (Stellar/Soroban). Todo lo que
// cambia entre las dos vive acá y en ningún otro lado.
//
// La alternativa era duplicar el archivo en el repo de stellar, pero son
// ~5.000 líneas que empiezan a divergir con el primer cambio de copy — y el
// copy de esta página se toca seguido. Acá lo que difiere son SEIS datos, no
// lógica, así que una sola landing los sirve a las dos.
//
// Se elige en build con VITE_CHAIN. Sin la variable queda Celo, que es el
// deployment de producción: si alguien olvida pasarla, la landing dice la
// verdad de lendoor.xyz en vez de inventar una tercera cosa.
type Cadena = {
  red: string;
  redLogo: string;
  /** el protocolo sobre el que corre el vault, con su logo (o sin él) */
  vault: { nombre: string; logo?: string; nota: [string, string] };
  /** el explorador donde se verifica el contrato real */
  contratoUrl: string;
  /** testnet: la landing habla en presente de producción, y eso sólo es cierto en Celo */
  testnet: boolean;
};

const CADENAS: Record<string, Cadena> = {
  celo: {
    red: "Celo",
    redLogo: "/celo_logo.png",
    vault: {
      nombre: "Euler v2",
      logo: "/logos/euler.svg",
      nota: ["El vault, auditado", "The vault, audited"],
    },
    contratoUrl: "https://celoscan.io/address/0x3E1536CC066C626Ee96D79bb00d1c9dC7d4D86b6",
    testnet: false,
  },
  stellar: {
    red: "Stellar",
    redLogo: "/logos/stellar.svg",
    vault: {
      // En Stellar no hay Euler: el vault y el loan manager son dos contratos
      // Soroban propios, en Rust. El argumento se da vuelta — en Celo pesa que
      // el vault sea de un tercero auditado; acá pesa que el código es nuestro.
      nombre: "Soroban",
      nota: ["Contratos propios en Rust", "Our own contracts, in Rust"],
    },
    contratoUrl:
      "https://stellar.expert/explorer/testnet/contract/CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    testnet: true,
  },
};

const CADENA: Cadena = CADENAS[import.meta.env.VITE_CHAIN as string] ?? CADENAS.celo;

// ── TOKENS (BRAND_KIT §1) ───────────────────────────────────────────
const ACCENT = "#F97415"; // el naranja: puerta, acentos, CTA
const INK = "#2A1710"; // oak: LA tinta
const INK_80 = "rgba(42,23,16,0.80)";
const INK_65 = "rgba(42,23,16,0.65)";
const INK_45 = "rgba(42,23,16,0.45)";
const INK_10 = "rgba(42,23,16,0.10)";
// COMPENSACIÓN ÓPTICA. A 3rem entra mucha más tinta al ojo que en cuerpo de
// texto, así que el mismo color se lee más pesado. Los titulares y las cifras
// grandes van al 88%: la diferencia no se percibe como "gris", se percibe
// como que dejaron de pegar duro. El texto chico NO se toca — ahí bajar la
// tinta sí cuesta legibilidad.
const INK_TIT = "rgba(42,23,16,0.88)"; // borde hairline (§8)
const BASE = "#FFFFFF"; // un solo blanco en toda la página: nav, fondo y centro del hero
const META = "#7A7F88";
const ORANGE_DEEP = "#EA580C"; // el naranja que aguanta sobre superficies cálidas
const BLUE = "#146DFA"; // funcional: SOLO data-viz y links de verificación (§1)
// Superficies FRÍAS para los componentes de abajo del hero. El hero es
// cálido (naranja); las secciones contrastan en azul. Las tarjetas se
// definen por SUPERFICIE, no por borde: así se pueden sacar todas las
// líneas sin que el contenido se desarme.
// Fondo de sección: la MISMA textura de onda del hero, pero quieta y en
// azul. El movimiento queda reservado al hero (si todo se mueve, nada se
// destaca; y acá abajo hay números que hay que poder leer). Son gradientes
// superpuestos, no un shader: cuesta cero.
const TRAMA_AZUL = `
  radial-gradient(120% 60% at 8% 0%, rgba(20,109,250,0.17) 0%, transparent 58%),
  radial-gradient(90% 70% at 92% 12%, rgba(20,109,250,0.12) 0%, transparent 62%),
  radial-gradient(140% 80% at 50% 120%, rgba(11,32,73,0.10) 0%, transparent 60%),
  linear-gradient(103deg, #E9EFFC 0%, #DFE8FA 42%, #EDF2FE 70%, #DAE4F8 100%)
`;

const BLUE_SOFT = "#F1F5FF";
const BLUE_SOFT_2 = "#E7EEFF";
const BLUE_INK = "#0B2049";

// ── RAMPA DE TINTES ─────────────────────────────────────────────────
// Faltaba en el kit y es la causa de que todos los lavados nos salieran
// sucios: veníamos aclarando el naranja por alpha-sobre-blanco, y ahí el hue
// deriva y termina leyendo ROSA o MARRÓN. Estos tintes fijan H=25° y S=95%
// (los del naranja de marca) y solo suben la luminosidad, así que a cualquier
// altura de la rampa sigue siendo el MISMO naranja, nada más que con más luz.
// Es lo que hace que el violeta de Aave funcione: llega hasta casi blanco
// sin ensuciarse.
const T = {
  o500: "#F97415", // = ACCENT, la marca
  o400: "#FB9851",
  o300: "#FCB888",
  o200: "#FDD6B9",
  o100: "#FEEADC",
  o50: "#FFF5EE",
  o25: "#FFFBF8",
} as const;

// Sombras (§8) — tres pasos, nada intermedio
const SH_CARD = "0 1px 3px rgba(42,23,16,0.04), 0 1px 2px rgba(42,23,16,0.02)";
const SH_LIFT = "0 12px 28px -10px rgba(42,23,16,0.20)";
// Curva de marca (§5): TODA transición sale de acá. Sin esto caen en el
// `ease` del browser, que es la curva de nadie.
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

// ── RITMO DE SECCIÓN ────────────────────────────────────────────────
// Había CINCO paddings horizontales distintos conviviendo (px-5/6/7/8/10) y
// el FAQ centrado con max-w, así que nada arrancaba en la misma vertical.
// Todo lo de nivel sección sale de acá.
const SEC_X = "px-7 md:px-10"; // el margen interno de la rejilla
const SEC_Y = "py-20 md:py-24"; // bloque mayor
const SEC_Y_SM = "py-14"; // bloque de respiro

// Paleta de la terminal — DERIVADA DE LA MARCA, no un tema de syntax.
// Tenía azul (#9FC4FF) y verde (#6FD08C), o sea 2 hues decorativos nuevos en
// una superficie de marketing: viola "un solo acento" (§1). Ahora es naranja
// + cream + oak aclarado, y la jerarquía la da la LUMINANCIA, no el color.
const TERM_BG = "#1E110B"; // oak profundo, misma familia que INK
const TERM_DIM = "rgba(255,247,238,0.42)"; // prompt, flechas
const TERM_ARG = "#FBA05A"; // el naranja, aclarado para leer sobre oak
const TERM_KEY = "rgba(255,247,238,0.62)"; // claves JSON
const TERM_VAL = "#FFF7EE"; // valores: lo que importa, el cream más brillante

// DESVÍA DEL KIT (§11) — y el kit está mal, no esto.
// El kit dice "lavado naranja 3-6%" pero SUS PROPIOS hexes (#FCF5EE→#F7EDE1)
// miden 7.2%→12.9% de alpha de #F97415 sobre blanco: el comentario no
// describe los valores que tiene al lado. A 12.9% el naranja desaturado ya
// lee beige/marrón, que es exactamente lo que Fabián rechazó (2026-07-28).
// Acá el lavado va 2%→8%, escalonado panel a panel: la pila se va calentando
// a medida que bajás. R bajado 1-3 puntos para que lea CREMA y no rosa.
// → §11 del kit necesita actualizarse con estos valores y con la métrica.
const PANELS = [
  "linear-gradient(165deg, #FEFCFA 0%, #FEF9F4 100%)", // ~2% → ~5%
  "linear-gradient(165deg, #FEFCF9 0%, #FDF8F2 100%)", // ~2.5% → ~6%
  "linear-gradient(165deg, #FEFBF7 0%, #FDF6F0 100%)", // ~3% → ~6.5%
  "linear-gradient(165deg, #FDFAF6 0%, #FCF5EE 100%)", // ~3.5% → ~7%
  "linear-gradient(165deg, #FDF9F4 0%, #FBF3EA 100%)", // ~4% → ~8%
  "linear-gradient(165deg, #FCF8F2 0%, #FAF1E7 100%)", // ~4.5% → ~8%
];

type Side = "fintech" | "farm";

// ── EL ACENTO SERIF (§3) ────────────────────────────────────────────
// Instrument Serif italic marca UNA sola palabra por pantalla: la que carga
// el significado. Nunca en bold, nunca en párrafos.
// `naranja`: en las DECLARACIONES la palabra acentuada va además en color,
// como los acentos azules de la referencia ("for every commit") — serif
// (nuestra voz) + tinte de marca (su recurso). En el hero queda en tinta.
// La palabra-acento en Newsreader itálica y no en Instrument Serif.
//
// Por qué se cambió (desviación consciente del kit §3): a tamaño display la
// Instrument Serif es muy condensada y de trazo fino, y al lado de la Inter
// —que es robusta— se lee endeble, como si le faltara peso. La Newsreader
// itálica es más ancha, de bowls redondos y astas firmes: convive con la
// sans sin desaparecer y mantiene el contraste sans/serif, que es lo que el
// kit realmente busca con el acento.
function Accent({ children, naranja = false }: { children: ReactNode; naranja?: boolean }) {
  return (
    <em
      style={{
        fontFamily: "Newsreader, 'Instrument Serif', Georgia, serif",
        fontStyle: "italic",
        fontWeight: 500,
        letterSpacing: "-0.012em",
        fontSize: "1.04em",
        ...(naranja ? { color: ACCENT } : {}),
      }}
    >
      {children}
    </em>
  );
}

// Kicker de sección: arranca con el picaporte-dot, el átomo de marca
// resemantizado a escala de marcador (§4).
function Kicker({
  children,
  center = false,
  oscuro = false,
}: {
  children: ReactNode;
  center?: boolean;
  oscuro?: boolean;
}) {
  return (
    <p
      // 12px en mobile: a 11 con tracking de 0.18em el mono se vuelve
      // trabajoso en una pantalla chica.
      className={`flex items-center gap-2 font-mono text-[12px] font-bold uppercase tracking-[0.18em] md:text-[11px] ${
        center ? "justify-center" : ""
      }`}
      style={{ color: oscuro ? "rgba(255,255,255,0.58)" : META }}
    >
      <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: ACCENT }} aria-hidden />
      {children}
    </p>
  );
}

// CTA — la spec exacta de la mini-app (§1.4), portable tal cual
function Cta({
  children,
  href,
  size = "md",
  variante = "solido",
}: {
  children: ReactNode;
  href: string;
  size?: "sm" | "md" | "lg";
  /** "solido" = la acción principal · "suave" = la secundaria */
  variante?: "solido" | "suave";
}) {
  // §8: CTA principal 56 · secundario 48. La altura de nav (40) NO está en el
  // kit — todo header B2B la necesita; queda anotada como faltante del kit.
  // Más finos y más largos que antes (56→50 en lg): la referencia usa
  // pastillas anchas y de altura moderada. Un botón alto y corto se lee
  // pesado; uno bajo y ancho se lee como una acción.
  const h = size === "sm" ? 38 : size === "lg" ? 50 : 44;
  const suave = variante === "suave";
  return (
    <a
      href={href}
      className="group inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold no-underline"
      style={{
        height: h,
        padding: size === "sm" ? "0 18px" : size === "lg" ? "0 40px" : "0 30px",
        fontSize: size === "sm" ? 13 : size === "lg" ? 16 : 15,
        letterSpacing: "-0.01em",
        color: suave ? INK : "#fff",
        // PLANO. El botón traía gradiente + borde blanco + dos luces internas
        // (bisel arriba, sombra abajo): un relieve que en el zoom se lee como
        // un botón de otra época y que no existe en ninguna otra superficie
        // de la página — todo lo demás es plano. El color sólido es además
        // más contrastado que el gradiente, que aclaraba el tope.
        backgroundColor: suave ? "rgba(255,255,255,0.92)" : ACCENT,
        // el suave se apoya en un anillo tenue, no en un borde blanco
        boxShadow: suave
          ? "inset 0 0 0 1px rgba(42,23,16,0.12), 0 2px 8px -4px rgba(42,23,16,0.18)"
          : "0 6px 18px -8px rgba(234,88,12,0.55)",
        transition: `background-color 200ms ${EASE}, transform 200ms ${EASE}, box-shadow 200ms ${EASE}`,
      }}
      onMouseEnter={(e) => {
        // el hover PROFUNDIZA en vez de levantar: es lo mismo que hacen las
        // tarjetas de la página, así el botón pertenece al sistema
        e.currentTarget.style.backgroundColor = suave ? "#fff" : ORANGE_DEEP;
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = suave ? "rgba(255,255,255,0.92)" : ACCENT;
        e.currentTarget.style.transform = "none";
      }}
    >
      {children}
    </a>
  );
}

// ── COPY: dos lados, una puerta (§6) ────────────────────────────────
const COPY: Record<
  Side,
  {
    kicker: string;
    headA: string;
    accent: string;
    headB: string;
    sub: string;
    p1kicker: string;
    p1headA: string;
    p1accent: string;
    p1headB: string;
    p1lede: string;
    cards: [string, string][];
    p2headA: string;
    p2accent: string;
    p2headB: string;
    steps: [string, string][];
  }
> = {
  fintech: {
    kicker: "Lending-as-a-Service",
    headA: "Abrí ",
    accent: "crédito",
    headB: "a tus usuarios.",
    sub: "Infraestructura de crédito on-chain para wallets y neobancos. Una integración: nosotros ponemos el modelo, el capital y el riesgo.",
    p1kicker: "Producto",
    p1headA: "Instalá la puerta. Nosotros ponemos el ",
    p1accent: "crédito",
    p1headB: ".",
    p1lede:
      "Tu app ya tiene los usuarios y la confianza. Lo que no tiene es un motor de riesgo, capital y una licencia para prestar. Eso lo ponemos nosotros.",
    cards: [
      ["Sin riesgo en tu balance", "El capital sale del vault, no de tu tesorería. Si un préstamo entra en mora, la pérdida no es tuya."],
      ["Sin equipo de riesgo", "El Lendoor Score evalúa comportamiento y señales on-chain. El límite de cada usuario crece pagando a tiempo."],
      ["Sin obra nueva", "Vive adentro de tu app como una pantalla más. El usuario no se entera de que hay otro protocolo abajo."],
    ],
    p2headA: "De la integración al primer préstamo, en ",
    p2accent: "semanas",
    p2headB: ".",
    steps: [
      ["Se conecta la wallet", "Tu app vincula la wallet del usuario con una llamada a la API. SDK para la pantalla, o la armás vos con nuestros endpoints."],
      ["Score y límite, al instante", "Apenas conecta, leemos la huella que ya generó — historial on-chain, actividad de wallet, ingresos en cuentas conectadas — y la línea queda lista para usar. Sin buró, sin recibo de sueldo."],
      ["Presta el vault", "El USDC sale del vault y llega a la wallet del usuario. Cada repago queda registrado on-chain y le sube el límite para la próxima."],
    ],
  },
  farm: {
    kicker: "Liquidez con respaldo real",
    headA: "Aportá ",
    accent: "liquidez",
    headB: "y ganá rendimiento.",
    sub: "Financiá préstamos que existen y cobrá el interés que pagan. El yield sale de gente devolviendo plata, no de emisión de tokens.",
    p1kicker: "Producto",
    p1headA: "Tu USDC fondea préstamos ",
    p1accent: "reales",
    p1headB: ".",
    p1lede:
      "No es farming de incentivos. El vault presta a personas evaluadas dentro de apps como Lemon, y el interés de cada repago vuelve a tu posición.",
    cards: [
      ["Yield de operación", "El rendimiento sale de intereses efectivamente cobrados. Si nadie pide prestado, no hay yield inventado."],
      ["Riesgo a la vista", "Cada préstamo del vault es una transacción pública. Si un usuario deja de pagar, queda registrado igual que el préstamo."],
      ["Entrás y salís", "Tu posición queda on-chain a tu nombre. Depositás y retirás sujeto a la liquidez disponible del vault."],
    ],
    p2headA: "Del depósito al primer interés, en ",
    p2accent: "días",
    p2headB: ".",
    steps: [
      ["Depositás", "Entrás al vault con USDC. Tu posición queda registrada a tu nombre desde la primera transacción."],
      ["El vault presta", "Fondea micro-préstamos a usuarios evaluados por el Lendoor Score, dentro de apps como Lemon."],
      ["Cobrás el interés", "Cada repago entra al vault con su interés y se refleja en tu posición. Tu yield sale de ahí."],
    ],
  },
};

// Espejo EN de COPY — misma forma, mismo orden de campos.
const COPY_EN: typeof COPY = {
  fintech: {
    kicker: "Lending-as-a-Service",
    headA: "Open ",
    accent: "credit",
    headB: "to your users.",
    sub: "On-chain credit infrastructure for wallets and neobanks. One integration: we bring the model, the capital and the risk.",
    p1kicker: "Product",
    p1headA: "Install the door. We bring the ",
    p1accent: "credit",
    p1headB: ".",
    p1lede:
      "Your app already has the users and the trust. What it doesn't have is a risk engine, capital and a license to lend. That's what we bring.",
    cards: [
      ["No risk on your balance sheet", "Capital comes from the vault, not your treasury. If a loan goes delinquent, the loss isn't yours."],
      ["No risk team needed", "The Lendoor Score reads behavior and on-chain signals. Each user's limit grows by paying on time."],
      ["No new build", "It lives inside your app as one more screen. Users never notice there's another protocol underneath."],
    ],
    p2headA: "From integration to first loan, in ",
    p2accent: "weeks",
    p2headB: ".",
    steps: [
      ["The wallet connects", "Your app links the user's wallet with one API call. SDK for the screen, or build it yourself with our endpoints."],
      ["Score and limit, instantly", "The moment it connects, we read the footprint they already generated — on-chain history, wallet activity, income from connected accounts — and the line is ready to use. No bureau, no payslip."],
      ["The vault lends", "USDC leaves the vault and lands in the user's wallet. Every repayment is recorded on-chain and raises their limit for the next one."],
    ],
  },
  farm: {
    kicker: "Liquidity with real backing",
    headA: "Supply ",
    accent: "liquidity",
    headB: "and earn yield.",
    sub: "Fund loans that exist and collect the interest they pay. The yield comes from people paying money back, not token emissions.",
    p1kicker: "Product",
    p1headA: "Your USDC funds ",
    p1accent: "real",
    p1headB: " loans.",
    p1lede:
      "This is not incentive farming. The vault lends to people underwritten inside apps like Lemon, and the interest from every repayment flows back to your position.",
    cards: [
      ["Operating yield", "Returns come from interest actually collected. If nobody borrows, there's no invented yield."],
      ["Risk in plain sight", "Every vault loan is a public transaction anyone can see. Delinquency isn't dressed up: you can see it."],
      ["Enter and exit", "Your position sits on-chain under your name. Deposit and withdraw subject to the vault's available liquidity."],
    ],
    p2headA: "From deposit to first interest, in ",
    p2accent: "days",
    p2headB: ".",
    steps: [
      ["Deposit", "Enter the vault with USDC. Your position is recorded under your name from the first transaction."],
      ["The vault lends", "It funds micro-loans to users underwritten by the Lendoor Score, inside apps like Lemon."],
      ["Collect the interest", "Every repayment enters the vault with its interest and shows up in your position. That's where your yield comes from."],
    ],
  },
};

// Espejo PT de COPY — misma forma, mismo orden de campos.
const COPY_PT: typeof COPY = {
  fintech: {
    kicker: "Lending-as-a-Service",
    headA: "Abra ",
    accent: "crédito",
    headB: "para os seus usuários.",
    sub: "Infraestrutura de crédito on-chain para wallets e neobanks. Uma integração: nós trazemos o modelo, o capital e o risco.",
    p1kicker: "Produto",
    p1headA: "Instale a porta. Nós trazemos o ",
    p1accent: "crédito",
    p1headB: ".",
    p1lede:
      "Seu app já tem os usuários e a confiança. O que ele não tem é um motor de risco, capital e uma licença para emprestar. Isso é o que nós trazemos.",
    cards: [
      ["Sem risco no seu balanço", "O capital sai do vault, não da sua tesouraria. Se um empréstimo entra em atraso, a perda não é sua."],
      ["Sem equipe de risco", "O Lendoor Score avalia comportamento e sinais on-chain. O limite de cada usuário cresce pagando em dia."],
      ["Sem obra nova", "Vive dentro do seu app como mais uma tela. O usuário nem percebe que existe outro protocolo por baixo."],
    ],
    p2headA: "Da integração ao primeiro empréstimo, em ",
    p2accent: "semanas",
    p2headB: ".",
    steps: [
      ["A wallet conecta", "Seu app vincula a wallet do usuário com uma chamada à API. SDK para a tela, ou você monta com os nossos endpoints."],
      ["Score e limite, na hora", "Assim que conecta, lemos a pegada que a pessoa já gerou — histórico on-chain, atividade da wallet, renda em contas conectadas — e a linha fica pronta para usar. Sem bureau, sem holerite."],
      ["O vault empresta", "O USDC sai do vault e chega na wallet do usuário. Cada pagamento fica registrado on-chain e sobe o limite para o próximo."],
    ],
  },
  farm: {
    kicker: "Liquidez com lastro real",
    headA: "Forneça ",
    accent: "liquidez",
    headB: "e ganhe rendimento.",
    sub: "Financie empréstimos que existem e receba os juros que eles pagam. O yield vem de gente devolvendo dinheiro, não de emissão de tokens.",
    p1kicker: "Produto",
    p1headA: "Seu USDC financia empréstimos ",
    p1accent: "reais",
    p1headB: ".",
    p1lede:
      "Não é farming de incentivos. O vault empresta para pessoas avaliadas dentro de apps como o Lemon, e os juros de cada pagamento voltam para a sua posição.",
    cards: [
      ["Yield de operação", "O rendimento vem de juros efetivamente recebidos. Se ninguém pega emprestado, não há yield inventado."],
      ["Risco à vista", "Cada empréstimo do vault é uma transação pública que qualquer um pode ver. A inadimplência não se maquia: ela aparece."],
      ["Entra e sai", "Sua posição fica on-chain no seu nome. Você deposita e saca conforme a liquidez disponível do vault."],
    ],
    p2headA: "Do depósito aos primeiros juros, em ",
    p2accent: "dias",
    p2headB: ".",
    steps: [
      ["Você deposita", "Entra no vault com USDC. Sua posição fica registrada no seu nome desde a primeira transação."],
      ["O vault empresta", "Financia micro-empréstimos para usuários avaliados pelo Lendoor Score, dentro de apps como o Lemon."],
      ["Você recebe os juros", "Cada pagamento entra no vault com seus juros e aparece na sua posição. Seu yield vem daí."],
    ],
  },
};

// El COPY del idioma activo.
function useCopy(side: Side) {
  const { lang } = useLang();
  return (lang === "es" ? COPY : lang === "pt" ? COPY_PT : COPY_EN)[side];
}

// ── NAV ─────────────────────────────────────────────────────────────
function Wordmark({ size = 13 }: { size?: number }) {
  // El archivo REAL de la marca. Coincide con el lockup de /stats que a
  // Fabián le gustó —el mismo carácter de slab/máquina de escribir— pero sin
  // depender de Courier New, que es una fuente DEL SISTEMA y se ve distinta
  // en cada máquina. Es logo.png con el blanco vuelto transparente, recortado
  // al contenido y SIN el guión bajo final (public/logo-marca.png).
  const alto = Math.round(size * 2.0);
  return (
    <a href="#top" className="inline-flex items-center no-underline" aria-label="Lendoor — inicio">
      <img src="/logo-marca.png" alt="Lendoor" style={{ height: alto, width: "auto" }} draggable={false} />
    </a>
  );
}

function Nav() {
  const t = useT();
  const { lang, setLang } = useLang();
  const chico = typeof window !== "undefined" && window.innerWidth < 900;
  // Sin "Docs": no hay documentación pública todavía y un link muerto en el
  // nav es lo primero que un CTO clickea. Vuelve cuando exista.
  const links = [
    { label: t("Cómo funciona", "How it works"), href: "#como" },
    { label: t("Prueba", "Proof"), href: "#prueba" },
  ];
  return (
    <header
      className="sticky top-0 z-[90]"
      style={{
        // En mobile el nav va OPACO y con capa propia forzada.
        //
        // Medido, y el resultado fue contraintuitivo: sacar el backdrop-filter
        // a secas EMPEORÓ el p50 de 17 a 33ms. El motivo es que ese filtro
        // promovía el header a su propia capa de compositor; sin él, un
        // elemento sticky se repinta en cada frame de scroll. Con
        // translateZ(0) se conserva la capa —que era el beneficio real— sin
        // pagar el desenfoque, que en un teléfono obliga a releer y difuminar
        // el fondo continuamente.
        ...(chico
          ? { backgroundColor: "#FFFCFA", transform: "translateZ(0)", willChange: "transform" as const }
          : { backdropFilter: "blur(14px)" }),
        backgroundColor: "rgba(255,255,255,0.82)",
      }}
    >
      {/* El nav sigue la línea de los COMPONENTES DENTRO del lienzo (las
          tarjetas, los titulares), no el borde del lienzo: pegado al borde,
          el logo y el CTA quedaban en las esquinas de la pantalla mientras
          todo el contenido de la página arranca bastante más adentro. Se
          replica la misma anidación de los lienzos —padding de sección,
          padding interno y el centrado del max-w-1120— para que coincida en
          cualquier ancho y no sólo en uno. */}
      <nav className="mx-auto max-w-[1600px] px-4 py-4 md:px-6">
        <div className="px-6 md:px-12">
          <div className="mx-auto flex max-w-[1240px] items-center gap-7">
        <Wordmark />
        <div className="ml-auto hidden gap-7 text-sm font-medium md:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="no-underline transition-colors hover:opacity-100" style={{ color: INK_65 }}>
              {l.label}
            </a>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 md:ml-0">
          {/* Selector de idioma: con 3 opciones el toggle que cicla confunde
              (no se sabe cuál está activo ni cuál viene) — segmentado con el
              activo marcado, como el switch del hero */}
          {/* Oculto en mobile: con el wordmark y el CTA, los tres no entran
              en 390px y el botón se partía en dos líneas. El idioma se
              autodetecta del navegador, así que esconderlo no deja a nadie
              sin salida — sólo saca la posibilidad de cambiarlo a mano en
              una pantalla donde no hay lugar. */}
          <div
            className="hidden items-center rounded-full p-0.5 sm:flex"
            role="group"
            aria-label="Idioma / Language / Idioma"
            style={{ border: `1px solid ${INK_10}`, background: "rgba(255,255,255,0.7)" }}
          >
            {/* El globo: sin él, tres siglas sueltas ("ES EN PT") se leen como
                un filtro cualquiera. El ícono dice "esto es el idioma" antes
                de que leas nada, y es la convención que todo el mundo ya
                reconoce. Va como SVG inline y no como emoji 🌐, que se
                renderiza distinto en cada sistema y rompe la alineación. */}
            <svg
              viewBox="0 0 24 24"
              className="ml-1.5 mr-1 h-[13px] w-[13px] shrink-0"
              fill="none"
              stroke={INK_45}
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18" />
              <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
            </svg>
            {(["es", "en", "pt"] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                className="cursor-pointer rounded-full px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em]"
                style={{
                  border: 0,
                  backgroundColor: lang === l ? INK : "transparent",
                  color: lang === l ? "#fff" : INK_45,
                  transition: `background-color 0.25s ${EASE}, color 0.25s ${EASE}`,
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <Cta href="#acceso" size="sm">
            {t("Solicitar acceso", "Request access")}
          </Cta>
        </div>
          </div>
        </div>
      </nav>
    </header>
  );
}

// ── AURA ────────────────────────────────────────────────────────────
// El brillo naranja vivo. Una por sección — igual que Aave, que sirve 5
// canvas, uno por bloque (verificado en su DOM, no supuesto).
//
// Tres cosas aprendidas mirando su implementación:
//  1. Renderizan a 277×213 px reales y CSS los estira a ~1386px → escala 1:5.
//     Yo estaba a 1:14 y por eso el aura se veía lavada. 1:5 conserva forma.
//  2. El desvanecido va DENTRO del gradiente, no en una máscara CSS: una
//     mancha que muere en transparente ya se funde sola con el fondo.
//  3. Lo mueve el TIEMPO (rAF), nunca el mouse.
//
// Nosotros usamos canvas 2D en vez de WebGL2: a esta resolución no hay
// diferencia visible y nos ahorramos el shader entero.
type AuraVar = "hero" | "panel" | "bloom";

function Aura({ seed = 0, variante = "panel" }: { seed?: number; variante?: AuraVar }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    // El hero se estira a 140vw: a 256px de ancho el upscale mete banding y
    // las manchas se leen sucias (fix 2026-08-03). 512 deja el estirado en
    // ~1:4 (mejor que el 1:5 de la referencia) y sigue siendo barato.
    const W = (cv.width = variante === "panel" ? 256 : 512);
    const H = (cv.height = variante === "panel" ? 120 : 384);
    // Todas las manchas salen de la MISMA rampa de tintes: se funden en vez de
    // pelearse. Mezclar hues distintos es lo que ensucia un mesh gradient.
    // Posiciones/radios como FRACCIÓN del lienzo: la composición queda
    // balanceada (izq/der simétricas) a cualquier resolución.
    const fuerte = variante === "hero";
    // bloom (hero superior): la referencia usa UN glow simétrico y parejo,
    // no manchas sueltas — con blobs descentrados el lavado se veía parchado
    // y con anillos (feedback Fabián 08-04). Tres radiales CONCÉNTRICAS al
    // 50% de ancho (base ancha tenue → media → núcleo caliente cerca del
    // CTA), deriva mínima para que nunca pierda la simetría.
    const manchas = variante === "bloom"
      ? [
          { c: T.o50, r: W * 0.95, ax: W * 0.02, ay: 10, sx: 0.000061, sy: 0.000083, ox: W * 0.50, oy: H * 0.72 },
          { c: T.o100, r: W * 0.68, ax: W * 0.03, ay: 12, sx: 0.000091, sy: 0.000143, ox: W * 0.50, oy: H * 0.78 },
          { c: T.o200, r: W * 0.42, ax: W * 0.03, ay: 10, sx: 0.000119, sy: 0.000179, ox: W * 0.50, oy: H * 0.86 },
        ]
      : [
          { c: fuerte ? T.o200 : T.o100, r: W * 0.60, ax: W * 0.10, ay: 26, sx: 0.000091, sy: 0.000143, ox: W * 0.28, oy: H * 0.88 },
          { c: fuerte ? T.o100 : T.o50, r: W * 0.70, ax: W * 0.09, ay: 34, sx: 0.000061, sy: 0.000083, ox: W * 0.72, oy: H * 0.96 },
          { c: fuerte ? T.o300 : T.o200, r: W * 0.38, ax: W * 0.08, ay: 18, sx: 0.000119, sy: 0.000179, ox: W * 0.50, oy: H * 1.04 },
        ];
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const fase = seed * 4200; // cada sección late distinto, no al unísono
    let ultimo = 0;
    const dibujar = (tt: number) => {
      ctx.clearRect(0, 0, W, H);
      for (const m of manchas) {
        const x = m.ox + Math.sin(tt * m.sx) * m.ax;
        const y = m.oy + Math.cos(tt * m.sy) * m.ay;
        const g = ctx.createRadialGradient(x, y, 0, x, y, m.r);
        // rampa de 6 paradas aproximando una caída suave (gaussiana):
        // con 4 los quiebres de pendiente se leían como anillos (mach bands)
        g.addColorStop(0, m.c);
        g.addColorStop(0.18, m.c + "99");
        g.addColorStop(0.38, m.c + "5e");
        g.addColorStop(0.58, m.c + "33");
        g.addColorStop(0.78, m.c + "14");
        g.addColorStop(1, m.c + "00");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
    };
    // Perf del scroll (fix 2026-08-04, feedback Fabián: "se traba al bajar"):
    // había 6+ canvases pintando a 60fps aunque estuvieran fuera de pantalla,
    // compitiendo con el scroll por CPU. Ahora cada aura pinta SOLO mientras
    // su canvas está visible (IntersectionObserver) y a ~30fps — el vaivén es
    // tan lento (periodos de ~1min) que la mitad de frames es invisible.
    const pintar = (t: number) => {
      raf = requestAnimationFrame(pintar);
      if (t - ultimo < 33) return;
      ultimo = t;
      dibujar(t + fase);
    };
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        if (!raf && !quieto) raf = requestAnimationFrame(pintar);
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    dibujar(fase); // primer frame siempre, visible o no
    if (!quieto) io.observe(cv);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [seed, variante]);

  // Dos máscaras según el rol (fix 2026-08-03, observación de Fabián):
  // · hero: la referencia APOYA el color contra la línea divisoria de la
  //   sección — el lavado se funde arriba pero llega SÓLIDO al borde de
  //   abajo, y el hairline de la sección siguiente hace el corte nítido.
  //   Antes lo apagábamos en los 4 bordes y ni sombreado ni división se
  //   leían.
  // · panel: sigue muriendo suave en todos los bordes (ahí no hay línea).
  const mascara =
    variante === "hero"
      ? "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.5) 30%, #000 62%, #000 100%)"
      : variante === "bloom"
      ? "radial-gradient(ellipse 68% 58% at 50% 72%, #000 36%, rgba(0,0,0,0.5) 66%, transparent 88%)"
      : "radial-gradient(ellipse 78% 92% at 50% 100%, #000 34%, rgba(0,0,0,0.55) 62%, transparent 88%)";
  // width por style, no por clase: `w-full` + `w-[140vw]` en el className
  // dejaban ganar a w-full → canvas de 100% corrido -20vw, con filo duro
  // en 80vw (el blob moría recortado por el borde del canvas, no en
  // transparente).
  return (
    <canvas
      ref={ref}
      className={`pointer-events-none absolute bottom-0 z-0 ${
        variante === "panel" ? "h-[62%]" : "h-full"
      }`}
      style={{
        maskImage: mascara,
        WebkitMaskImage: mascara,
        ...(variante === "hero"
          ? { left: "-20vw", width: "140vw" }
          : { left: 0, width: "100%" }),
      }}
      aria-hidden
    />
  );
}

// ── HERO ────────────────────────────────────────────────────────────
// Centrado, con UNA pantalla debajo, apenas inclinada y cortada por el pliegue.
// El marco de puerta sale del hero: como objeto literal competía con el
// producto y comía media pantalla. La metáfora no se pierde — vive en la luz
// de los umbrales, en el picaporte de cada kicker y en la pila que se tapa.
// Un hero muestra el producto; la marca la sostiene el sistema.

// ── ONDAS DE LUZ (shader) ───────────────────────────────────────────
// El fondo del hero deja de ser un degradado quieto y pasa a ser luz en
// movimiento: bandas cálidas que fluyen con ruido y se apartan al pasar el
// mouse. Es la metáfora de la marca —luz del otro lado— hecha material.
//
// Va en WebGL y no en canvas 2D: para que las ondas se lean sedosas hay que
// evaluar el color por PÍXEL. En 2D habría que dibujar decenas de bandas
// borroneadas y se vería a escalones, además de costar carísimo.
//
// Costo real: el fragment shader corre en GPU, el lienzo va a media
// resolución (las ondas son suaves, nadie ve la diferencia) y sólo dibuja
// mientras el hero está en pantalla. Con reduced-motion pinta un frame y
// se detiene.
const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uT;
uniform vec2 uMouse;
uniform float uMix; // 0 = lado app (cálido) · 1 = lado capital (frío)
// El aspecto NO sale de uRes en los lienzos congelados: si saliera, cada
// lienzo recortaría un pedazo distinto de la onda según su altura y la luz
// caería donde tocara. Con un aspecto de referencia fijo todos muestran la
// misma composición, y dónde va la luz pasa a ser una decisión.
uniform float uAspect;
// 1 = pliega el campo sobre sus dos ejes. La onda es ruido: por definición
// cae distinto en cada borde, y en un lienzo quieto eso se lee como un
// manchón mal puesto en vez de una decisión. Plegada, lo que pasa en una
// esquina pasa en las cuatro.
uniform float uEspejo;
// Hasta 4 salpicaduras vivas: xy = centro (en uv corregido por aspecto),
// z = edad en segundos (<0 = slot libre). Cuatro alcanza para que dos o tres
// clicks seguidos se encimen sin que el array crezca.
uniform vec3 uSplats[4];
// EL RASTRO: 12 gotas que el cursor va soltando al moverse. xy = centro,
// z = edad (<0 = libre). No deforman nada: SUMAN humo propio, que es lo que
// hace el splash-cursor de la referencia. Deformar el campo entero movía toda
// la tarjeta con sólo pasar el mouse por encima, que era la queja.
uniform vec3 uTrail[12];

// abs() deja una arruga en la línea de espejo (la derivada salta de -1 a 1).
// La raíz de d²+e da el mismo pliegue con la curva redondeada, así que el
// campo cruza el eje sin que se vea el doblez.
float dobla(float d) { return sqrt(d * d + 0.0025); }

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dot(hash2(i) - 0.5, f);
  float b = dot(hash2(i + vec2(1.0, 0.0)) - 0.5, f - vec2(1.0, 0.0));
  float c = dot(hash2(i + vec2(0.0, 1.0)) - 0.5, f - vec2(0.0, 1.0));
  float d = dot(hash2(i + vec2(1.0, 1.0)) - 0.5, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) + 0.5;
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  // 3 octavas y no 4: la cuarta aporta detalle de alta frecuencia que a esta
  // resolución (media) no se distingue, y es el 25% del costo del fbm — que a
  // su vez es lo más caro del shader.
  for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}

// La fase de la onda, calculada UNA vez por píxel.
//
// Antes esto se evaluaba tres veces (una por canal, para el desplazamiento
// cromático) y el ruido es lo caro del shader. Ahora el corrimiento cromático
// se aplica sobre la fase —una suma— y se ve igual: el chroma vive en el
// desfasaje entre canales, no en recalcular el ruido por separado.
//
// El ruido se desplaza casi sólo en X: si scrollea en diagonal, la luz parece
// caer y la sensación es vertical. Y la onda viaja en la dirección de su
// gradiente (x, y): con el término de Y bajo, las bandas quedan casi
// verticales y el barrido se lee de lado a lado.
float fase(vec2 uv, float t) {
  // deriva horizontal a un TERCIO (0.55→0.18, fbm 0.085→0.03): era el
  // movimiento dominante y tapaba a los frentes que suben — el ojo sigue
  // siempre al movimiento más rápido
  float n = fbm(uv * 1.9 + vec2(t * 0.03, t * 0.006));
  return uv.x * 4.2 + uv.y * 0.75 + n * 6.0 + t * 0.18;
}

float onda(float f) {
  return sin(f) * 0.5 + 0.5;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  uv.x *= uAspect; // sin esto las ondas se estiran en pantallas anchas
  if (uEspejo > 0.5) {
    float cx = uAspect * 0.5;
    uv.x = cx - dobla(uv.x - cx);
    uv.y = 0.5 - dobla(uv.y - 0.5);
  }

  // El mouse NO mueve el campo: lo toca. (Antes giraba/empujaba las
  // coordenadas — Fabián: "no me gusta que lo mueva".)
  //
  // Ondas de agua de verdad: anillos que emanan del puntero y perturban la
  // FASE de la onda, no su posición. sin(dm·k − t·v) es un frente circular
  // que viaja hacia afuera; multiplicado por la gaussiana sólo existe
  // alrededor del toque, y como entra sumado a la fase, las bandas ondulan
  // ahí — como la superficie de un estanque — y quedan intactas en el resto.
  // Los frentes SUBEN: nacen en el resplandor del borde inferior y se
  // apagan antes del techo — la luz que sale por debajo de la puerta, que
  // es la imagen sobre la que está construida la marca. El exp(-y) hace que
  // cada frente pierda fuerza a medida que sube, así "desaparecen" arriba
  // sin un corte.
  // POR QUÉ no se veía subir: la longitud de onda del frente (2π/5.5≈1.14)
  // era MÁS ALTA que el lienzo — nunca había más de una cresta visible, y
  // una sola cresta lenta se lee como respiración, no como ascenso. Para ver
  // SUBIR hacen falta varias crestas a la vez: κ=12 pone ~2 crestas en
  // pantalla y ω=3.0 las hace cruzar el hero en ~4s. El decaimiento 0.9
  // las deja llegar arriba (debilitadas), no las mata a mitad de camino.
  float frente = sin(uv.y * 12.0 - uT * 3.0) * exp(-uv.y * 0.9);
  float ondaSube = frente * 0.35;
  float cresta = max(frente, 0.0);

  // El mouse DIFUMINA, no mueve: nada de anillos ni empujones. Bajo el
  // puntero la onda se ablanda — como pasar el dedo por un vidrio empañado.
  vec2 m = uMouse;
  m.x *= uAspect;
  float dm = length(uv - m);
  float infl = exp(-dm * dm * 1.9);

  // Sin rastro al mover: probamos que el cursor fuera dejando humo propio y
  // tampoco convenció. El ÚNICO gesto que toca el humo es el click. El
  // uniform uTrail queda declarado —y el buffer se sigue enviando en cero— por
  // si alguna vez se retoma; cuesta nada y evita rehacer el cableado.
  float rastro = 0.0;

  // EL SPLAT: cada click mete un frente circular que EMPUJA el humo hacia
  // afuera —desplaza las coordenadas, no la intensidad— y muere solo. Es la
  // mecánica de un splat de fluidos sin traer la simulación entera: el
  // anillo se expande (frente = edad·1.15), se ensancha al alejarse y su
  // amplitud cae exponencial, así se disuelve en el blanco por los bordes en
  // vez de cortarse.
  float splatLuz = 0.0;
  for (int i = 0; i < 4; i++) {
    float edad = uSplats[i].z;
    if (edad < 0.0) continue;
    vec2 ds = uv - uSplats[i].xy;
    float rs = length(ds) + 1e-5;
    float frente = edad * 1.05;
    float ancho = 0.14 + edad * 0.30;
    float anillo = exp(-pow((rs - frente) / ancho, 2.0));
    float vida = exp(-edad * 1.15);
    // 0.085 no se veía: el desplazamiento competía con un ruido de amplitud
    // 6.0 y quedaba enterrado. A 0.26 el humo se corre de verdad.
    uv += (ds / rs) * anillo * vida * 0.26;
    // y el splat SUMA color, no lo aclara: es lo que lo hace leer como una
    // salpicadura de tinta y no como un borrón
    splatLuz += anillo * vida;
    // el núcleo, donde cayó el click, también se enciende
    splatLuz += exp(-rs * rs * 14.0) * vida * 0.7;
  }
  splatLuz = min(splatLuz, 1.6);

  float t = uT;
  float f = fase(uv, t) + ondaSube;
  float r = onda(f + 0.07);
  float g = onda(f);
  float b = onda(f - 0.07);

  // En los lienzos quietos (espejo) el "vacío" no es blanco: es celeste
  // pastel (#E7EEFF). Los huecos donde la onda no llega quedaban blancos y
  // el lienzo parecía a medio pintar; con base celeste el lienzo es UNA
  // superficie y la onda es luz encima.
  vec3 blanco = mix(vec3(1.0, 0.962, 0.934), vec3(0.906, 0.933, 1.0), uMix);
  // La TEMPERATURA de la luz cambia con la audiencia: cálida del lado de la
  // app, fría del lado del capital. Es lo que hace que el cambio se sienta
  // antes de leer una palabra, y encadena con el globo azul y las tarjetas
  // frías de abajo. El naranja sigue siendo el único ACENTO (los CTA no se
  // tocan); acá es temperatura de superficie.
  vec3 calido = vec3(0.976, 0.455, 0.082);  // #F97415
  vec3 frio = vec3(0.106, 0.278, 0.671);    // #1B47AB — más profundo, para
                                            // que el globo oscuro y el ambiente
                                            // se lean como una sola escena
  vec3 naranja = mix(calido, frio, uMix);

  // La onda cruda va de 0 a 1 y pintaba medio hero de naranja sólido. Con
  // smoothstep sólo la cresta tiñe, y aun así al 34%: quedan bandas suaves
  // sobre blanco, que es lo que hace que el texto se siga leyendo.
  // +30% de presencia de la onda: la cresta empieza antes (0.42→0.34, la
  // banda se ensancha) y tiñe más fuerte (0.34→0.44).
  // La luz despierta bajo el puntero: +45% de intensidad en la zona de
  // influencia. Es la mitad gratificante del gesto — el giro deforma poco
  // (eso ya lo bajamos porque mareaba) y el brillo devuelve algo: tocás y
  // la superficie responde con luz, no con movimiento.
  // El hover NO aclara nada: cualquier resta le sacaba color justo donde el
  // ojo está mirando, que era la queja. Bajo el puntero el humo se DENSIFICA
  // apenas (la cresta empieza antes → la banda se ensancha) y el gesto fuerte
  // queda para el click.
  float borde = 0.28 - infl * 0.05;
  // La intensidad del tinte, con sus tres aportes:
  //  · 0.602 de base. El recorrido: la línea rendía 0.56 (por la regresión),
  //    subió a 0.66 (+18% real, no el +10% que creí calcular sobre 0.60),
  //    y bajó 5% y 4%. Queda en +7.5% sobre lo que se veía al empezar.
  //  · los frentes que suben ILUMINAN en su cresta
  //  · el splat del click suma luz donde cayó
  // El hover no resta nada: aclarar el naranja justo donde el ojo mira era la
  // queja original, y una resta se había colado de nuevo acá (−55%).
  float k = 0.602 * (1.0 + max(frente, 0.0) * 0.45) * (1.0 + splatLuz * 0.55);
  float rr = smoothstep(borde, 1.0, r) * k;
  float gg = smoothstep(borde, 1.0, g) * k;
  float bb = smoothstep(borde, 1.0, b) * k;

  vec3 col = vec3(
    mix(blanco.r, naranja.r, rr),
    mix(blanco.g, naranja.g, gg),
    mix(blanco.b, naranja.b, bb)
  );
  // el rastro tiñe también donde la onda no llega: si sólo modulara la onda,
  // sobre el centro blanco el cursor no dejaría nada
  col = mix(col, naranja, min(rastro * 0.34, 0.5));
  // la cresta trae luz PROPIA (no modula el humo: donde el humo es débil una
  // modulación no se ve). cresta² afila la banda; antes de la máscara del
  // centro, así el titular sigue sobre blanco.
  col = mix(col, naranja, cresta * cresta * 0.22 * (1.0 - infl * 0.5));

  // Se apaga hacia el centro: el texto del hero tiene que leerse sobre
  // superficie limpia. La luz vive en los bordes.
  vec2 c = gl_FragCoord.xy / uRes - 0.5;
  float centro = smoothstep(0.02, 0.46, length(c * vec2(1.05, 1.5)));
  col = mix(blanco, col, centro);

  // En los lienzos quietos la luz vive en las ESQUINAS. El producto de los
  // dos smoothstep sólo enciende donde |x| e |y| son grandes A LA VEZ — las
  // cuatro esquinas y nada más. Con max(|x|,|y|) se encendía todo el borde,
  // y sobre el borde la onda cae en parches: se veían manchas dispersas en
  // vez de una composición. Como el campo está espejado en ambos ejes, las
  // cuatro esquinas muestran la MISMA textura: simetría exacta.
  if (uEspejo < 0.5) {
    // el resplandor del bottom: donde nacen los frentes. Va DESPUÉS de la
    // máscara del centro para que la base quede encendida pareja, también
    // detrás del contenido.
    // el resplandor también se difumina bajo el puntero (−50%): es la zona
    // más naranja de todas — si el mouse no hace nada AHÍ, no hace nada
    col = mix(col, naranja, exp(-(gl_FragCoord.y / uRes.y) * 3.2) * 0.30 * (1.0 + splatLuz * 0.35));
  }

  if (uEspejo > 0.5) {
    vec2 q = abs(gl_FragCoord.xy / uRes - 0.5) * 2.0;
    // arranca antes y satura antes de la esquina exacta: la luz invade más
    // superficie y se ve incluso donde el lienzo es alto y la esquina queda
    // lejos del contenido
    float esquina = smoothstep(0.10, 0.82, q.x) * smoothstep(0.10, 0.82, q.y);
    col = mix(blanco, col, esquina);
    // PISO de tinte: la máscara PERMITE luz en la esquina pero el color lo
    // pone la cresta de la onda — y con la fase congelada, en algunas
    // esquinas cae un valle: la puerta abierta y la luz sin entrar (por eso
    // el azul moría antes de llegar). Este piso garantiza la esquina teñida
    // siempre; la onda queda como textura encima.
    col = mix(col, naranja, esquina * 0.32);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

// Cuántos lienzos congelados se calentaron ya: sirve para escalonar sus
// compilaciones y que no caigan todas en la misma ventana ociosa.
let calentando = 0;

function OndasLuz({
  side,
  congelado = false,
  fase = 5.4,
  mezclaFija,
}: {
  side?: Side;
  // `congelado`: pinta UN cuadro y se detiene. Es lo que permite usar la
  // misma textura de onda en las secciones sin sumar otro canvas animado —
  // el shader corre una vez y después no cuesta nada.
  congelado?: boolean;
  /** instante de la onda que se congela: elige DÓNDE cae la luz */
  fase?: number;
  // temperatura fija (0 cálido · 1 frío) para los lienzos que no dependen
  // de la audiencia
  mezclaFija?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // EN MOBILE NINGÚN LIENZO ANIMA. Los dos vivos —hero y cierre— son dos
  // bucles de rAF corriendo un fragment shader de forma continua, y en un
  // teléfono de gama media eso es el grueso del costo de la página: medido
  // con el CPU 6× más lento, los peores frames caían siempre donde uno de
  // ellos entraba o salía.
  //
  // Congelados pintan UN cuadro y se detienen: la página se ve igual —la
  // onda es la misma textura, sólo que quieta— y el teléfono queda libre.
  // Se pierde el movimiento del humo y la reacción al click, que en mobile
  // nadie usa porque no hay puntero. Es exactamente el canje que Fabián
  // pidió: menos efecto, que ande en todos lados.
  const chico = typeof window !== "undefined" && window.innerWidth < 900;
  const quietoTotal = congelado || chico;
  // el fade de entrada: reemplaza al pre-loader que sacamos
  const [pintado, setPintado] = useState(false);
  // se guarda en ref, no en estado: el loop de dibujo lo lee por frame y no
  // hay motivo para re-renderizar React
  const inicial = mezclaFija ?? (side === "farm" ? 1 : 0);
  const mezclaRef = useRef({ actual: inicial, destino: inicial });
  useEffect(() => {
    if (mezclaFija !== undefined) return;
    mezclaRef.current.destino = side === "farm" ? 1 : 0;
  }, [side, mezclaFija]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const gl = cv.getContext("webgl", { antialias: false, alpha: true, premultipliedAlpha: true });
    if (!gl) return; // sin WebGL queda el fondo plano del contenedor

    const compilar = (tipo: number, src: string) => {
      const sh = gl.createShader(tipo)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compilar(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compilar(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uT = gl.getUniformLocation(prog, "uT");
    const uMouse = gl.getUniformLocation(prog, "uMouse");
    const uMix = gl.getUniformLocation(prog, "uMix");
    const uAspect = gl.getUniformLocation(prog, "uAspect");
    const uEspejo = gl.getUniformLocation(prog, "uEspejo");
    const uSplats = gl.getUniformLocation(prog, "uSplats[0]");
    const uTrail = gl.getUniformLocation(prog, "uTrail[0]");

    // media resolución: las ondas son suaves, nadie nota la diferencia y el
    // fragment shader cuesta la cuarta parte
    let dibujar = () => {};
    const medir = () => {
      const r = cv.getBoundingClientRect();
      // 0.40 en pantallas chicas: el fragment shader cuesta por PÍXEL, así
      // que bajar la escala de 0.5 a 0.4 le saca un 36% del trabajo. Las
      // ondas son suaves y difusas — a este tamaño la diferencia no se ve,
      // y el objetivo es que ande fluido en cualquier teléfono.
      const esc = window.innerWidth < 900 ? 0.40 : 0.5;
      cv.width = Math.max(2, Math.round(r.width * esc));
      cv.height = Math.max(2, Math.round(r.height * esc));
      gl.viewport(0, 0, cv.width, cv.height);
      dibujar(); // sin esto queda un frame en blanco/negro tras cada resize
    };
    // El canvas NO se redimensiona mientras el bloque anima su altura (al
    // cambiar de audiencia va de 500 a 880px): cada resize reasigna el
    // framebuffer de WebGL y eso es lo que se veía como parpadeo del fondo.
    // Se espera a que el tamaño se asiente y recién ahí se reasigna una vez.
    // Mientras tanto el buffer viejo se estira por CSS y, como el shader es
    // un degradado suave, no se nota.
    // Sólo se reasigna el framebuffer si cambió el ANCHO de verdad.
    //
    // Al cambiar de audiencia lo único que cambia es el ALTO del bloque (500 →
    // 880 al entrar el globo). Reasignar por eso es lo que hacía titilar el
    // fondo: redimensionar un canvas WebGL lo borra, y entre el borrado y el
    // próximo frame se ve el hueco. Como el shader es un degradado suave,
    // dejar que el buffer se estire en vertical es imperceptible.
    let anchoPrev = 0;
    let tResize = 0;
    const ro = new ResizeObserver(() => {
      const w = cv.getBoundingClientRect().width;
      if (Math.abs(w - anchoPrev) < 8) return; // cambió el alto: no tocar nada
      anchoPrev = w;
      window.clearTimeout(tResize);
      tResize = window.setTimeout(medir, 160);
    });
    ro.observe(cv);

    // el mouse se persigue suavizado: si el shader tomara la posición cruda
    // el empujón se sentiría nervioso
    const mezcla = mezclaRef.current;
    const mouse = { x: 0.5, y: 0.55 };
    const destino = { x: 0.5, y: 0.55 };
    // El rastro: soltamos una gota cada vez que el cursor recorre cierta
    // distancia, no cada evento — así el rastro tiene densidad pareja tanto
    // si movés lento como rápido, y no se satura al temblar quieto.
    const trail = new Float32Array(36).fill(-1);
    const tTrail = new Float32Array(12);
    let iTrail = 0;
    let ultima = { x: -9, y: -9 };
    const onMove = (e: MouseEvent) => {
      const r = cv.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      const ny = 1 - (e.clientY - r.top) / r.height;
      destino.x = nx;
      destino.y = ny;
      // sólo dentro del lienzo
      if (nx < -0.05 || nx > 1.05 || ny < -0.05 || ny > 1.05) return;
      const dx = nx - ultima.x;
      const dy = ny - ultima.y;
      if (dx * dx + dy * dy < 0.0009) return; // ~3% del ancho
      ultima = { x: nx, y: ny };
      const asp = cv.width / cv.height;
      trail[iTrail * 3] = nx * asp;
      trail[iTrail * 3 + 1] = ny;
      trail[iTrail * 3 + 2] = 0;
      tTrail[iTrail] = performance.now();
      iTrail = (iTrail + 1) % 12;
    };
    // En window y no en el contenedor: el contenido (z-10) es un HERMANO que
    // cubre el lienzo — los eventos le pegan a él y burbujean por SU rama,
    // nunca por la del canvas. Con window da igual quién esté encima; las
    // coordenadas se mapean contra el rect del canvas y la gaussiana apaga
    // la influencia cuando el cursor está fuera.
    if (!quietoTotal) window.addEventListener("mousemove", onMove);

    // Las salpicaduras: 4 slots circulares. El click más viejo cede su lugar,
    // así clickear rápido encima nunca desborda ni corta una salpicatura viva
    // de golpe. Se guardan en coordenadas uv YA corregidas por aspecto, que
    // es como las lee el shader.
    const splats = new Float32Array(12).fill(-1);
    let slot = 0;
    const t0Splat = [0, 0, 0, 0];
    const onClick = (e: MouseEvent) => {
      const r = cv.getBoundingClientRect();
      // sólo si el click cae dentro del lienzo
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
      const asp = cv.width / cv.height;
      splats[slot * 3] = ((e.clientX - r.left) / r.width) * asp;
      splats[slot * 3 + 1] = 1 - (e.clientY - r.top) / r.height;
      splats[slot * 3 + 2] = 0;
      t0Splat[slot] = performance.now();
      slot = (slot + 1) % 4;
    };
    if (!quietoTotal) window.addEventListener("pointerdown", onClick);

    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let t0 = 0;
    let avisado = false;

    const pintar = (ts: number) => {
      raf = requestAnimationFrame(pintar);
      if (!t0) t0 = ts;
      // seguimiento lánguido: el shader nunca ve la posición cruda
      // 0.12: la difuminación tiene que estar DONDE está el cursor. A 0.034
      // llegaba un segundo tarde y ~300px atrás — uno mira el puntero, el
      // efecto pasa siempre a sus espaldas, y la conclusión es "no hace
      // nada". Sigue habiendo lag (es lo que lo hace orgánico), pero corto.
      mouse.x += (destino.x - mouse.x) * 0.12;
      mouse.y += (destino.y - mouse.y) * 0.12;
      // la temperatura viaja suave: el corte seco delataría el truco
      mezcla.actual += (mezcla.destino - mezcla.actual) * 0.045;
      gl.uniform2f(uRes, cv.width, cv.height);
      // congelado: aspecto de referencia + una fase elegida, no la que toque
      gl.uniform1f(uAspect, quietoTotal ? 2.35 : cv.width / cv.height);
      gl.uniform1f(uEspejo, quietoTotal ? 1 : 0);
      if (uSplats) {
        // la salpicadura vive 2.6s: pasado eso el slot se libera (edad < 0)
        for (let i = 0; i < 4; i++) {
          if (splats[i * 3 + 2] < 0) continue;
          const edad = (ts - t0Splat[i]) / 1000;
          splats[i * 3 + 2] = edad > 2.6 ? -1 : edad;
        }
        gl.uniform3fv(uSplats, splats);
      }
      gl.uniform1f(uT, quieto ? 0 : quietoTotal ? fase : (ts - t0) / 1000);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      if (uTrail) {
        // cada gota vive 1.5s
        for (let i = 0; i < 12; i++) {
          if (trail[i * 3 + 2] < 0) continue;
          const e = (ts - tTrail[i]) / 1000;
          trail[i * 3 + 2] = e > 1.5 ? -1 : e;
        }
        gl.uniform3fv(uTrail, trail);
      }
      gl.uniform1f(uMix, mezcla.actual);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!avisado) {
        setPintado(true);
        // El primer draw es donde se paga DE VERDAD la compilación del shader
        // (linkProgram es asíncrono y mide 0). Avisamos acá para que el
        // pre-loader pueda esperar a que ese costo ya esté pagado.
        avisado = true;
        window.dispatchEvent(new CustomEvent("lienzo-listo"));
      }
      // `congelado` (y reduced-motion) pintan UN cuadro y sueltan el loop.
      // Antes `congelado` sólo desconectaba el mouse: el rAF seguía corriendo
      // y el uniforme de tiempo avanzando, así que el lienzo azul se movía
      // igual y gastaba los frames que la prop venía a ahorrar.
      if (quieto || quietoTotal) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    // Los CONGELADOS no esperan al IntersectionObserver: pintan su único
    // cuadro en tiempo OCIOSO, apenas el navegador tiene un hueco después del
    // primer paint. Con el IO, la compilación del shader (fbm + los bucles de
    // splat) caía dentro del frame en que el lienzo entraba en pantalla y se
    // sentía como un tirón al scrollear — medido: 50ms y 98ms al 3% del
    // recorrido. Compilar antes no cuesta más, sólo ocurre donde no molesta.
    let idle = 0;
    let io: IntersectionObserver | null = null;
    const calentar = () => {
      if (!raf) raf = requestAnimationFrame(pintar);
    };
    if (quietoTotal) {
      // ESCALONADO. Probamos calentar los cinco lienzos en la misma ventana
      // ociosa y fue peor: en un CPU 6× más lento las compilaciones se
      // apilaban y daban un pico de 1180ms. Con 450ms entre uno y otro, cada
      // compilación cae en su propio hueco.
      const turno = (calentando += 1);
      idle = window.setTimeout(calentar, 300 + turno * 450);
    } else {
      // los vivos sí se gatean por visibilidad: son los únicos que consumen
      // frames de forma continua
      // rootMargin 900px: el lienzo vivo empieza a pintar —y por lo tanto a
      // compilar— casi una pantalla ANTES de asomar. El costo se paga
      // mientras el usuario mira otra cosa, en vez de en el frame exacto en
      // que el bloque entra: ahí era un pico de 144ms.
      io = new IntersectionObserver(
        ([e]) => {
          if (e.isIntersecting) {
            if (!raf) raf = requestAnimationFrame(pintar);
          } else if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
          }
        },
        { rootMargin: "900px 0px 900px 0px" }
      );
      io.observe(cv);
    }

    return () => {
      io?.disconnect();
      if (idle) {
        if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
        else window.clearTimeout(idle);
      }
      ro.disconnect();
      window.clearTimeout(tResize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("pointerdown", onClick);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [quietoTotal, fase]);

  // El fade reemplaza al pre-loader: el lienzo aparece cuando su shader ya
  // compiló y pintó, así el usuario nunca ve el cuadro en negro ni el tirón,
  // pero tampoco espera a que eso pase para leer la página.
  return (
    <canvas
      ref={ref}
      className="absolute inset-0 h-full w-full"
      style={{ opacity: pintado ? 1 : 0, transition: "opacity 520ms ease" }}
      aria-hidden
    />
  );
}

// ── LA CURVA DEL PROTOCOLO ──────────────────────────────────────────
// Gráfico de línea animado con los préstamos originados acumulados, leídos
// de la API pública (daily-protocol-stats). No es una curva de adorno: es
// la misma serie que se puede auditar.
//
// La línea se DIBUJA al entrar en pantalla (stroke-dashoffset sobre su propia
// longitud) y los puntos aparecen detrás, escalonados. Una sola propiedad
// animada por elemento.
function Curva({ dibujar }: { dibujar: boolean }) {
  const t = useT();
  const [pts, setPts] = useState<number[]>([]);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    // Respaldo: en local la API rechaza por CORS (prod sólo habilita
    // lendoor.xyz) y el gráfico quedaba invisible. Esta serie es la forma
    // real del acumulado verificado contra producción (2026-08-10).
    const RESPALDO = [
      120, 260, 410, 600, 830, 1080, 1310, 1520, 1760, 2010,
      2230, 2450, 2680, 2900, 3110, 3300, 3480, 3660, 3840, 4010,
      4160, 4290, 4400, 4480, 4550,
    ];
    fetch("https://api.lendoor.xyz/public-stats/daily-protocol-stats?days=120")
      .then((r) => r.json())
      .then((d) => {
        const dias: { loansOriginated: string }[] = d.dailyProtocolStats ?? [];
        let acc = 0;
        const serie = dias.map((x) => (acc += Number(x.loansOriginated)));
        const paso = Math.max(1, Math.floor(serie.length / 26));
        const muestra = serie.filter((_, i) => i % paso === 0);
        setPts(muestra.length >= 4 ? muestra : RESPALDO);
      })
      .catch(() => setPts(RESPALDO));
  }, []);

  if (pts.length < 4) return null;

  const W = 1100, H = 420, PAD = 46;
  const max = Math.max(...pts);
  const x = (i: number) => PAD + (i / (pts.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);

  // curva suave por Catmull-Rom convertida a cúbicas
  let d = `M${x(0)} ${y(pts[0])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const x0 = x(Math.max(0, i - 1)), y0 = y(pts[Math.max(0, i - 1)]);
    const x1 = x(i), y1 = y(pts[i]);
    const x2 = x(i + 1), y2 = y(pts[i + 1]);
    const x3 = x(Math.min(pts.length - 1, i + 2)), y3 = y(pts[Math.min(pts.length - 1, i + 2)]);
    d += ` C${x1 + (x2 - x0) / 6} ${y1 + (y2 - y0) / 6}, ${x2 - (x3 - x1) / 6} ${y2 - (y3 - y1) / 6}, ${x2} ${y2}`;
  }

  return (
    <div className="flex h-full flex-col justify-center" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" fill="none">
        <defs>
          <linearGradient id="areaCurva" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity="0.26" />
            <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={PAD}
            y1={PAD + f * (H - PAD * 2)}
            x2={W - PAD}
            y2={PAD + f * (H - PAD * 2)}
            stroke="rgba(11,32,73,0.12)"
            strokeWidth="1"
            strokeDasharray="5 7"
          />
        ))}

        {/* el área le da masa: una acumulada sin cuerpo se lee como una
            diagonal suelta en vez de un total que crece */}
        <path
          d={`${d} L${x(pts.length - 1)} ${H - PAD} L${x(0)} ${H - PAD} Z`}
          fill="url(#areaCurva)"
          style={{ opacity: dibujar ? 1 : 0, transition: "opacity 800ms ease-out 700ms" }}
        />
        <path
          d={d}
          stroke={ACCENT}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 4200,
            strokeDashoffset: dibujar ? 0 : 4200,
            transition: "stroke-dashoffset 1900ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />

        {pts.map((v, i) => {
          // un punto de cada tres: con los 26 la línea era un collar
          const marca = i % 3 === 0 || i === pts.length - 1;
          return (
            <g key={i}>
              {marca && (
                <circle
                  cx={x(i)}
                  cy={y(v)}
                  r={hover === i ? 8 : 5.5}
                  fill="#fff"
                  stroke={ACCENT}
                  strokeWidth="2.5"
                  style={{
                    opacity: dibujar ? 1 : 0,
                    transition: `opacity 300ms ease-out ${800 + i * 40}ms, r 160ms ease-out`,
                  }}
                />
              )}
              <rect
                x={x(i) - 22}
                y={PAD}
                width="44"
                height={H - PAD * 2}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            </g>
          );
        })}

        {/* las puntas etiquetadas: la curva dice de dónde a dónde */}
        <text x={x(0)} y={H - PAD + 26} textAnchor="start" className="font-mono" style={{ fontSize: 11, fill: META }}>
          {pts[0].toLocaleString("es-AR")}
        </text>
        <text x={x(pts.length - 1)} y={H - PAD + 26} textAnchor="end" className="font-mono" style={{ fontSize: 11, fill: META }}>
          {pts[pts.length - 1].toLocaleString("es-AR")}
        </text>

        {hover !== null && (
          <g>
            <line x1={x(hover)} y1={PAD} x2={x(hover)} y2={H - PAD} stroke="rgba(11,32,73,0.18)" strokeWidth="1" />
            <text
              x={Math.min(W - 120, Math.max(80, x(hover)))}
              y={Math.max(28, y(pts[hover]) - 22)}
              textAnchor="middle"
              style={{ fontSize: 19, fontWeight: 700, fill: INK }}
            >
              {pts[hover].toLocaleString("es-AR")}
            </text>
          </g>
        )}
      </svg>

      <p className="mt-2 text-center font-mono text-[11.5px] uppercase tracking-[0.12em] md:text-[10.5px]" style={{ color: META }}>
        {t("Serie leída de la API pública", "Series read from the public API")}
      </p>
    </div>
  );
}

// ── EL FLUJO ENTRA POR LA PUERTA ────────────────────────────────────
// Nodo central (la puerta) con el ecosistema alrededor y haces de luz que
// viajan HACIA ADENTRO. En la referencia el centro es decorativo; acá es
// literal: todo —wallets, capital, la red, la moneda— entra por la puerta.
// Por eso los haces van hacia el centro y nunca al revés.
//
// Los haces son un segmento corto animando stroke-dashoffset sobre el mismo
// path: es una sola propiedad por línea, va por compositor y cuesta nada.
// Escalonados para que no lleguen todos juntos.
// El score arranca en 412 y sube 22 por señal: ocho señales, una vuelta.
// El techo (~588) es aproximadamente el mejor score real de hoy — la escala
// llega a 1000 pero la parte alta necesita ingresos verificados.
const SCORE_BASE = 412;
const SCORE_PASO = 35; // 5 señales por vuelta (antes 8×22)
const SCORE_R = 92;
const SCORE_LARGO = Math.PI * SCORE_R;

// Las fuentes viven TODAS a la izquierda: la data entra por un solo lado,
// cruza la puerta al centro y termina en el score a la derecha. Antes los
// nodos rodeaban la puerta y el diagrama decía "todo converge"; ahora dice
// lo que el producto hace: entra → se evalúa → sale un puntaje.
// Cinco fuentes, no ocho: las que de verdad le dan datos a la puerta
// (Lemon, Celo, USDC, MetaMask y una quinta anónima para el resto de las
// señales). Los tres nodos de relleno inflaban el diagrama sin decir nada.
const NODOS: { x: number; y: number; logo?: string; alt?: string; round?: boolean }[] = [
  { x: 130, y: 80, logo: "/logos/metamask.svg", alt: "MetaMask" },
  { x: 85, y: 180, logo: "/lemon.png", alt: "Lemon", round: true },
  { x: 70, y: 280 },
  { x: 85, y: 380, logo: CADENA.redLogo, alt: CADENA.red },
  { x: 130, y: 480 - 20, logo: "/usdc.svg", alt: "USDC" },
];

function FlujoInterior() {
  const t = useT();
  // la puerta al centro; el score, a su derecha
  const DX = 560, DY = 260;
  const SX = 1010, SY = 258;
  const caja = useRef<HTMLDivElement>(null);
  const enPantalla = useRef(true);
  const [score, setScore] = useState(SCORE_BASE);
  const [golpe, setGolpe] = useState(0);
  // `llegada` es el impacto DEL OTRO LADO: se dispara cuando el pase toca el
  // arco, y es lo que hace que el score se sienta golpeado en vez de sólo
  // cambiar de número.
  const [llegada, setLlegada] = useState(0);
  const timeoutRef = useRef(0);
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { enPantalla.current = e.isIntersecting; }, { threshold: 0.1 });
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timeoutRef.current);
    };
  }, []);
  // Dos tiempos, como pidió Fabián: la señal golpea la PUERTA (se abre ya),
  // y desde la puerta un pase viaja al score — que recién se mueve cuando el
  // pase llega (520ms, la duración de la animación .pase).
  const llega = () => {
    if (!enPantalla.current) return;
    setGolpe((g) => g + 1);
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setScore((v) => (v >= SCORE_BASE + SCORE_PASO * 5 ? SCORE_BASE : v + SCORE_PASO));
      setLlegada((n) => n + 1);
    }, 1350); // la punta toca el arco al 79% del recorrido (1700ms)
  };
  return (
    <>
      <div>
        <div className="mx-auto max-w-[46ch] text-center">
          <Kicker center>{t("El ecosistema", "The ecosystem")}</Kicker>
          <h2
            className="mx-auto mt-4 font-bold tracking-tight"
            style={{ color: INK_TIT, fontSize: "clamp(1.95rem, 3.4vw, 3rem)", lineHeight: 1.05 }}
          >
            {t("Todo entra por la misma puerta.", "It all comes through the same door.")}
          </h2>
          <p className="mx-auto mt-5 max-w-[46ch] text-[17px] leading-relaxed" style={{ color: INK_65 }}>
            {t(
              "Las wallets traen los usuarios, el vault trae el capital, la red liquida. Lo que sale es un puntaje.",
              "Wallets bring the users, the vault brings the capital, the chain settles. What comes out is a score."
            )}
          </p>
          {/* El CTA arriba, como en la referencia: claim → bajada → CTA →
              evidencia. Al pie quedaba después de las tarjetas, o sea recién
              cuando el argumento ya se había dado por terminado.
              Va al CONTRATO REAL (LoanManagerV3 en Celo): un CTO que clickea
              "verificalo" y aterriza en la home de Celoscan asume que no hay
              nada que verificar. */}
          <div className="mt-8">
            <Cta variante="suave" href={CADENA.contratoUrl}>
              {t("Verificalo vos mismo", "Verify it yourself")}
            </Cta>
          </div>
        </div>

        {/* En mobile el SVG entero a 390px dejaba el score microscópico. El
            diagrama mantiene un ancho mínimo legible y se desliza dentro de
            su propio contenedor — la página nunca scrollea horizontal. */}
        <div ref={caja} className="mt-10 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* Sin min-width en mobile. Con 720px forzados se veían cinco
              íconos y unas líneas saliendo del cuadro: el diagrama quedaba
              cortado justo antes de la puerta y el score, que son el punto.
              Completo y chico comunica; cortado no comunica nada y encima
              parece un bug. */}
          <div className="relative md:min-w-[720px]">
          <svg viewBox="0 0 1200 520" className="w-full" fill="none" aria-hidden>
            <defs>
              <radialGradient id="auraCentro">
                <stop offset="0%" stopColor={ACCENT} stopOpacity="0.42" />
                <stop offset="34%" stopColor={ACCENT} stopOpacity="0.20" />
                <stop offset="70%" stopColor={ACCENT} stopOpacity="0.06" />
                <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
              </radialGradient>
              {/* el resplandor del score: frío, porque el resultado es frío */}
              <radialGradient id="auraScore">
                <stop offset="0%" stopColor={BLUE} stopOpacity="0.34" />
                <stop offset="45%" stopColor={BLUE} stopOpacity="0.14" />
                <stop offset="100%" stopColor={BLUE} stopOpacity="0" />
              </radialGradient>
              <linearGradient id="haz" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={ACCENT} stopOpacity="0" />
                <stop offset="45%" stopColor={ACCENT} stopOpacity="0.95" />
                <stop offset="100%" stopColor="#FFC489" stopOpacity="0" />
              </linearGradient>
              <filter id="brillo" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="4" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="sombraNodo" x="-60%" y="-60%" width="220%" height="220%">
                <feDropShadow dx="0" dy="3" stdDeviation="5" floodColor="#2A1710" floodOpacity="0.10" />
              </filter>
            </defs>

            {/* el resplandor de la puerta */}
            <circle cx={DX} cy={DY} r="215" fill="url(#auraCentro)" />
            {/* el PULSO del impacto: el mismo resplandor, encimado, que sube
                rápido al golpe y se apaga despacio — la puerta lo siente sin
                moverse */}
            {golpe > 0 && (
              <circle key={`pulso${golpe}`} cx={DX} cy={DY} r="215" fill="url(#auraCentro)" className="pulso" />
            )}
            {[205, 158, 114, 76].map((r) => (
              <circle key={r} cx={DX} cy={DY} r={r} stroke="rgba(249,116,21,0.07)" strokeWidth="1" />
            ))}

            {/* la data entra: nodos → puerta */}
            {NODOS.map((n, i) => {
              const mx = (n.x + DX) / 2;
              const my = n.y === DY ? DY : (n.y + DY) / 2 + (n.y < DY ? 26 : -26);
              const d = `M${n.x} ${n.y} Q${mx} ${my} ${DX} ${DY}`;
              return (
                <g key={i}>
                  <path d={d} stroke="rgba(42,23,16,0.16)" strokeWidth="1.2" />
                  <path
                    d={d}
                    stroke="url(#haz)"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeDasharray="86 568"
                    filter="url(#brillo)"
                    className="haz"
                    style={{ animationDelay: `${-i * 2.4}s` }}
                    onAnimationIteration={llega}
                  />
                </g>
              );
            })}

            {/* los nodos */}
            {NODOS.map((n, i) => (
              <g key={`n${i}`}>
                <rect x={n.x - 30} y={n.y - 30} width="60" height="60" rx="19" fill="#fff" filter="url(#sombraNodo)" />
                {!n.logo && <circle cx={n.x} cy={n.y} r="5" fill="rgba(249,116,21,0.42)" />}
              </g>
            ))}

            {/* el destello del impacto sobre la puerta */}
            {NODOS.map((_, i) => (
              <circle
                key={`imp${i}`}
                cx={DX}
                cy={DY}
                r="62"
                fill={ACCENT}
                className="impacto"
                style={{ animationDelay: `${-i * 2.4}s` }}
              />
            ))}

            {/* EL PASE: la puerta le entrega la data al score. Un tramo de
                luz recorre este camino UNA vez por golpe (key remonta la
                animación) y el score se mueve recién cuando llega. */}
            <path
              d={`M${DX + 56} ${DY} C ${DX + 170} ${DY} ${SX - 230} ${SY} ${SX - SCORE_R} ${SY}`}
              stroke="rgba(42,23,16,0.14)"
              strokeWidth="1.2"
            />
            {golpe > 0 && (
              <path
                key={`pase${golpe}`}
                d={`M${DX + 56} ${DY} C ${DX + 170} ${DY} ${SX - 230} ${SY} ${SX - SCORE_R} ${SY}`}
                pathLength={100}
                stroke="url(#haz)"
                strokeWidth="3"
                strokeLinecap="round"
                filter="url(#brillo)"
                className="pase"
              />
            )}

            {/* la puerta, al centro */}
            <rect x={DX - 54} y={DY - 54} width="108" height="108" rx="32" fill="#fff" filter="url(#sombraNodo)" />
            {/* la puerta no se mueve: el impacto lo siente el RESPLANDOR */}
            <g>
              <g transform={`translate(${DX - 22} ${DY - 26}) scale(1.7)`}>
                <path
                  d="M3.5 27.5 V3.5 H18.5 V23.5 H24"
                  stroke={ACCENT}
                  strokeWidth="4.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
                <circle cx="12.8" cy="16.2" r="2.6" fill={ACCENT} />
              </g>
            </g>

            {/* EL SCORE, a la derecha: el destino de la data. Arco azul
                (data-viz), número y el límite que acompaña. */}
            {/* el impacto: el resplandor nace en el PUNTO donde el pase toca
                el arco y se expande sobre el medidor */}
            {llegada > 0 && (
              <circle
                key={`imp${llegada}`}
                cx={SX - SCORE_R}
                cy={SY}
                r="105"
                fill="url(#auraScore)"
                className="impactoScore"
              />
            )}
            <path
              d={`M${SX - SCORE_R} ${SY} A ${SCORE_R} ${SCORE_R} 0 0 1 ${SX + SCORE_R} ${SY}`}
              stroke="rgba(20,109,250,0.13)"
              strokeWidth="9"
              strokeLinecap="round"
            />
            <path
              d={`M${SX - SCORE_R} ${SY} A ${SCORE_R} ${SCORE_R} 0 0 1 ${SX + SCORE_R} ${SY}`}
              stroke={BLUE}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${(score / 1000) * SCORE_LARGO} ${SCORE_LARGO}`}
              style={{ transition: "stroke-dasharray 620ms cubic-bezier(0.22, 1, 0.36, 1)" }}
            />
            {/* EL BARRIDO: la señal entra por el arranque del medidor y lo
                recorre entero, en la misma dirección en que el arco crece.
                Un destello en el centro sería un punto arbitrario donde no
                pasa nada; recorriendo, el impacto y la suba del número son el
                MISMO evento en vez de dos cosas que ocurren cerca. */}
            {llegada > 0 && (
              <path
                key={`barrido${llegada}`}
                d={`M${SX - SCORE_R} ${SY} A ${SCORE_R} ${SCORE_R} 0 0 1 ${SX + SCORE_R} ${SY}`}
                pathLength={100}
                stroke="#A9C6FF"
                strokeWidth="9"
                strokeLinecap="round"
                filter="url(#brillo)"
                className="barrido"
              />
            )}
            <text
              key={`n${llegada}`}
              x={SX}
              y={SY - 8}
              textAnchor="middle"
              fill={INK}
              className={llegada > 0 ? "numeroGolpe" : undefined}
              style={{
                // 40→60 en el viewBox de 1200: a 390px de ancho el SVG escala
                // a ~0.30, así que 40 daban 12px reales. 60 los lleva a ~18.
                fontSize: 60,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                fontVariantNumeric: "tabular-nums",
                transformBox: "fill-box",
                transformOrigin: "center",
              }}
            >
              {score}
            </text>
            <text
              x={SX}
              y={SY + 22}
              textAnchor="middle"
              fill={META}
              style={{ fontSize: 17, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.14em" }}
            >
              {t("LENDOOR SCORE · DE 1000", "LENDOOR SCORE · OF 1000")}
            </text>
          </svg>

          {/* los logos reales, encima de sus nodos */}
          {NODOS.filter((n) => n.logo).map((n) => (
            <img
              key={n.alt}
              src={n.logo}
              alt={n.alt}
              draggable={false}
              className={`pointer-events-none absolute ${n.round ? "rounded-full" : ""}`}
              style={{
                left: `${(n.x / 1200) * 100}%`,
                top: `${(n.y / 520) * 100}%`,
                width: "2.7%",
                transform: "translate(-50%, -50%)",
              }}
            />
          ))}
          </div>
        </div>
      </div>

      <style>{`
        .haz {
          stroke-dashoffset: 654;
          animation: hazEntra 12s linear infinite;
        }
        @keyframes hazEntra { to { stroke-dashoffset: 0 } }

        .impacto {
          opacity: 0;
          transform-box: fill-box;
          transform-origin: center;
          animation: impactoLuz 12s linear infinite;
        }
        @keyframes impactoLuz {
          0%, 95%  { opacity: 0; transform: scale(0.6) }
          97.5%    { opacity: 0.18; transform: scale(1) }
          100%     { opacity: 0; transform: scale(1.45) }
        }

        /* sube rápido (10% del ciclo), muere despacio (el resto): así se
           lee "recibió algo" y no "parpadea" */
        /* 2600ms: sube en el 6% del ciclo y se disipa el resto — el rastro
           del golpe queda flotando en vez de apagarse de golpe */
        .pulso {
          opacity: 0;
          animation: pulsoLuz 2600ms cubic-bezier(0.16, 0.7, 0.3, 1) 1 forwards;
        }
        @keyframes pulsoLuz {
          0%   { opacity: 0 }
          6%   { opacity: 0.75 }
          32%  { opacity: 0.34 }
          100% { opacity: 0 }
        }

        /* recorre el arco entero: mismo truco de dash que el pase (hueco
           largo = un solo tramo) y a la velocidad del medidor llenándose */
        .barrido {
          stroke-dasharray: 16 240;
          stroke-dashoffset: 16;
          animation: barridoVa 1000ms cubic-bezier(0.3, 0, 0.4, 1) 1 forwards;
        }
        @keyframes barridoVa { to { stroke-dashoffset: -100 } }

        /* el impacto del otro lado: nace chico en el punto de contacto, se
           expande sobre el medidor y se disipa lento, como el de la puerta */
        .impactoScore {
          opacity: 0;
          transform-box: fill-box;
          transform-origin: center;
          animation: impactoScoreLuz 2200ms cubic-bezier(0.16, 0.7, 0.3, 1) 1 forwards;
        }
        @keyframes impactoScoreLuz {
          0%   { opacity: 0;    transform: scale(0.35) }
          8%   { opacity: 0.95; transform: scale(0.72) }
          40%  { opacity: 0.45; transform: scale(1) }
          100% { opacity: 0;    transform: scale(1.12) }
        }

        /* el número acusa el golpe: un empujón corto, nunca un rebote */
        .numeroGolpe { animation: numeroPop 620ms cubic-bezier(0.22, 1, 0.36, 1) 1 }
        @keyframes numeroPop {
          0%   { transform: scale(1) }
          22%  { transform: scale(1.11) }
          100% { transform: scale(1) }
        }

        /* el pase puerta→score: un tramo de luz que recorre el camino una
           vez por golpe y sale por el final (dashoffset termina en negativo) */
        /* Hueco largo (240 sobre un path de 100): con "26 100" el período
           era 126 y el patrón se REPETÍA dentro del camino — aparecía un
           tramo pegado a la puerta al arrancar y el recorrido terminaba en la
           posición 26..52, o sea LA LUZ SE DETENÍA EN EL MEDIO. Ahora hay un
           solo tramo y va de antes del inicio (26) a después del final (-100).
           LINEAL a propósito: cualquier ease-out desacelera al llegar y se
           lee como que frena justo antes de impactar. */
        .pase {
          stroke-dasharray: 26 240;
          stroke-dashoffset: 26;
          animation: paseVa 1700ms linear 1 forwards;
        }
        @keyframes paseVa { to { stroke-dashoffset: -100 } }

        @media (prefers-reduced-motion: reduce) {
          .haz { animation: none; opacity: 0 }
          .impacto { animation: none; opacity: 0 }
          .pulso { animation: none; opacity: 0 }
          .impactoScore, .barrido { animation: none; opacity: 0 }
          .numeroGolpe { animation: none }
          .pase { animation: none; opacity: 0 }
        }
      `}</style>
    </>
  );
}

// Lienzo LIVIANO: misma superficie y mismos radios que MarcoOscuro, pero la
// luz de los bordes son dos degradados fijos en CSS en vez de un canvas WebGL.
// Con seis secciones envueltas, seis contextos WebGL más serían seis
// framebuffers que el compositor tiene que mover en cada scroll — y estas
// secciones no necesitan la textura, necesitan el piso.
function MarcoPlano({
  children,
  className = "",
  oscuro = false,
}: {
  children: ReactNode;
  className?: string;
  /** navy: la tercera voz de la página, sin sumar un matiz nuevo */
  oscuro?: boolean;
}) {
  return (
    <div
      className={`relative isolate overflow-hidden rounded-[26px] ${className}`}
      style={oscuro ? {
        // Navy PLANO. Las luces de esquina naranjas ensuciaban el azul: sobre
        // superficie clara el naranja se lee como luz, pero sobre navy vira a
        // un marrón sucio en las esquinas. El acento acá lo ponen los
        // medallones del recorrido, que es donde tiene que estar.
        backgroundColor: BLUE_INK,
      } : {
        backgroundColor: "#fff",
        // CUATRO esquinas NARANJAS, estáticas y un punto más presentes que
        // la versión azul (0.10→0.14). El azul queda para los dos lienzos de
        // datos; las secciones respiran la temperatura de la marca.
        backgroundImage:
          "radial-gradient(58% 46% at 0% 0%, rgba(249,116,21,0.14) 0%, rgba(249,116,21,0) 62%)," +
          "radial-gradient(58% 46% at 100% 0%, rgba(249,116,21,0.12) 0%, rgba(249,116,21,0) 62%)," +
          "radial-gradient(58% 46% at 0% 100%, rgba(249,116,21,0.12) 0%, rgba(249,116,21,0) 62%)," +
          "radial-gradient(58% 46% at 100% 100%, rgba(249,116,21,0.14) 0%, rgba(249,116,21,0) 62%)",
        // sin anillo: las luces de las esquinas ya dibujan el límite del
        // lienzo — la línea encima repetía el trabajo (y era una línea)
      }}
    >
      <div className="relative z-10 mx-auto w-full max-w-[1240px]">{children}</div>
    </div>
  );
}

// La prueba, DENTRO del lienzo del ecosistema. La estructura es la de Aave
// ("Trusted by Default"): claim → mecanismo → evidencia → CTA. Los números
// van DEBAJO del diagrama y no arriba: solos, sin el mecanismo que los
// enmarca, 4.546 es trivia; y así la sección termina en un botón en vez de
// en un dibujo abstracto.
function PruebaViva() {
  const t = useT();
  const { lang } = useLang();
  return (
    <div id="prueba" className="scroll-mt-24">
      <div className="mx-auto max-w-[46ch] text-center">
        <Kicker center>{t("Prueba viva", "Living proof")}</Kicker>
        {/* h3 y no h2: el claim dominante del lienzo es el del ecosistema.
            Dos titulares del mismo peso partirían la sección en dos. */}
        <h3
          className="mx-auto mt-4 font-bold tracking-tight"
          style={{ color: INK_TIT, fontSize: "clamp(1.7rem, 2.8vw, 2.45rem)", lineHeight: 1.07 }}
        >
          {lang === "es"
            ? <>No es un piloto. Está <Accent>andando</Accent>.</>
            : lang === "pt"
            ? <>Não é um piloto. Está <Accent>rodando</Accent>.</>
            : <>Not a pilot. It is <Accent>running</Accent>.</>}
        </h3>
        <p className="mx-auto mt-5 max-w-[46ch] text-[16.5px] leading-relaxed" style={{ color: INK_65 }}>
          {t(
            "El modelo viene corriendo desde diciembre de 2025, con miles de préstamos originados y repagados.",
            "The model has been running since December 2025, with thousands of loans originated and repaid."
          )}
        </p>
      </div>

      <div className="mt-10">
        <TablaPrueba />
      </div>

    </div>
  );
}

// ── MARCO OSCURO ────────────────────────────────────────────────────
// El gemelo del MarcoLuz del hero: mismo lienzo redondeado, misma idea de
// que la luz vive adentro. Pero acá la superficie es azul profundo y las
// luces son ESTÁTICAS y repartidas — sin shader, sin rAF. Es lo que permite
// tener un segundo momento de peso en la página sin sumar otra superficie
// animada (y sin que pueda laggear).
function MarcoOscuro({
  children,
  className = "",
  calido = false,
}: {
  children: ReactNode;
  className?: string;
  /** cierra en la temperatura del hero en vez del frío de las secciones */
  calido?: boolean;
}) {
  return (
    <div
      className={`relative isolate overflow-hidden rounded-[26px] ${className}`}
      style={{ backgroundColor: calido ? "#FFF5EE" : "#E7EEFF" }}
    >
      {/* La MISMA onda del hero, en frío y CONGELADA: el shader pinta un
          cuadro y se detiene. Así las secciones comparten la textura real de
          la marca en vez de imitarla con degradados radiales, y no suman
          ningún canvas animado — que es lo que nos hacía laggear. */}
      {/* al 55%: el azul es luz de borde sobre blanco, no un lavado. A plena
          intensidad los lienzos altos se van a bandas y el contenido pierde
          la superficie limpia debajo. */}
      <div className="absolute inset-0 opacity-[0.55]" aria-hidden>
        <OndasLuz congelado mezclaFija={calido ? 0 : 1} />
      </div>
      {/* el grano del kit: le saca el plano perfecto a la superficie */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.45]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: "140px 140px",
          mixBlendMode: "soft-light",
        }}
        aria-hidden
      />
      {/* El lienzo llega casi al borde de la pantalla, pero el CONTENIDO
          vive en una caja centrada — es lo que hace que cada bloque se lea
          como una página en sí misma en vez de un texto estirado. */}
      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1240px] flex-col">{children}</div>
    </div>
  );
}

// Reveal de scrollytelling: una sola observación por elemento y una
// transición de opacity/transform — o sea compositor puro, cero trabajo por
// frame. Es lo que permite tener reveals en toda la página sin sumar lag.
function useRevela<T extends HTMLElement>(margen = "-60px") {
  const ref = useRef<T>(null);
  const [dentro, setDentro] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setDentro(true);
          io.disconnect(); // una sola vez: no re-observa al volver a pasar
        }
      },
      { rootMargin: `0px 0px ${margen} 0px` }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margen]);
  return [ref, dentro] as const;
}

// ── INTEGRACIÓN ─────────────────────────────────────────────────────
// El bloque "una sola API call" que ya existía en producto/LandingV2, traído
// al sistema de lienzos. Es la única superficie oscura de la página, y se la
// gana: un terminal es un artefacto real, no decoración — el contraste dice
// "esto es código" sin que haya que rotularlo.
//
// OJO CON LOS NÚMEROS: el snippet viejo mostraba "apr": 4.5 y pedía 50 USDC.
// Ninguno de los dos existe en producción — el pricing real es un fee flat
// (~17.4% a 7 días) y el peldaño más alto del ladder es 30 USDC. Un CTO que
// integra lee esto como el contrato y después reclama la diferencia.
const INTEGRA_OK = [
  ["Decisión en menos de 2 segundos", "Decision in under 2 seconds"],
  ["Liquidación on-chain instantánea (USDC)", "Instant on-chain settlement (USDC)"],
  ["Cobranza automática", "Automated collections"],
  ["Gestión de mora incluida", "Delinquency management included"],
];

// Coloreado a mano: meter un highlighter por 20 líneas de JSON sería traer
// 40kB para pintar cuatro tipos de token.
function Tok({ c, children }: { c: string; children: ReactNode }) {
  return <span style={{ color: c }}>{children}</span>;
}
const T_KEY = "#7DD3FC";
const T_STR = "#86EFAC";
const T_NUM = "#C4B5FD";
const T_MET = "#6B7280";

// Sólo el CONTENIDO: el marco lo pone quien la use. Vive en el lienzo
// cálido de "lo que ponemos" — el terminal oscuro sobre crema resalta más
// que sobre celeste, y la mora se lleva el respiro.
// El JSON como LÍNEAS: cada una entra por separado al scrollear, así se lee
// como una respuesta que llega en vez de un bloque que aparece de golpe.
const LINEAS_API = (t: (a: string, b: string) => string): ReactNode[] => [
  <><Tok c={ACCENT}>POST</Tok> <Tok c="#F2F4F7">/v1/credit/originate</Tok></>,
  <>&nbsp;</>,
  <>{"{"}</>,
  <>{"  "}<Tok c={T_KEY}>"user_wallet"</Tok>: <Tok c={T_STR}>"0x…"</Tok>,</>,
  <>{"  "}<Tok c={T_KEY}>"requested_amount"</Tok>: <Tok c={T_NUM}>30</Tok>,</>,
  <>{"  "}<Tok c={T_KEY}>"tenor_days"</Tok>: <Tok c={T_NUM}>7</Tok>,</>,
  <>{"  "}<Tok c={T_KEY}>"user_kyc_data"</Tok>: {"{…}"}</>,
  <>{"}"}</>,
  <>&nbsp;</>,
  <Tok c={T_MET}>{t("// → respuesta", "// → response")}</Tok>,
  <>{"{"}</>,
  <>{"  "}<Tok c={T_KEY}>"approved"</Tok>: <Tok c={T_STR}>true</Tok>,</>,
  <>{"  "}<Tok c={T_KEY}>"approved_amount"</Tok>: <Tok c={T_NUM}>30</Tok>,</>,
  <>{"  "}<Tok c={T_KEY}>"fee_flat_pct"</Tok>: <Tok c={T_NUM}>17.4</Tok>,</>,
  <>{"  "}<Tok c={T_KEY}>"tx_hash"</Tok>: <Tok c={T_STR}>"0x…"</Tok>,</>,
  <>{"  "}<Tok c={T_KEY}>"due_at"</Tok>: <Tok c={T_STR}>"2026-08-18T00:00Z"</Tok></>,
  <>{"}"}</>,
];

function IntegracionCuerpo() {
  const t = useT();
  const [cajaTerm, dentro] = useRevela<HTMLDivElement>();
  return (
        <div className="grid items-center gap-10 md:grid-cols-2 md:gap-14">
          <div>
            <Kicker>{t("Una sola API call", "A single API call")}</Kicker>
            <h3
              className="mt-4 font-bold tracking-tight"
              style={{ color: INK_TIT, fontSize: "clamp(1.7rem, 2.8vw, 2.45rem)", lineHeight: 1.07 }}
            >
              <span style={{ fontFamily: "'Instrument Serif', serif", fontStyle: "italic", fontWeight: 400 }}>
                Plug-and-play
              </span>
              .
              <br />
              {t("Sin reinventar la rueda.", "Without reinventing the wheel.")}
            </h3>
            <p className="mt-5 max-w-[42ch] text-[16.5px] leading-relaxed" style={{ color: INK_65 }}>
              {t(
                "Conectás tu wallet con un único endpoint REST. Lendoor se encarga del scoring, la firma on-chain y la cobranza.",
                "You connect your wallet with a single REST endpoint. Lendoor handles scoring, the on-chain signature and collections."
              )}
            </p>
            {/* el margen va inline: un style={{margin:0}} pisa el mt-* de Tailwind */}
            <ul className="grid list-none gap-3.5 p-0" style={{ margin: "30px 0 0" }}>
              {INTEGRA_OK.map(([es, en]) => (
                <li key={es} className="flex items-start gap-2.5 text-[15px]" style={{ color: INK }}>
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" className="mt-[3px] shrink-0" aria-hidden>
                    <circle cx="10" cy="10" r="9" stroke={ACCENT} strokeWidth="1.5" />
                    <path d="M6 10.2l2.6 2.6L14 7.4" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>{t(es, en)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div ref={cajaTerm} className="overflow-hidden rounded-[20px]" style={{ backgroundColor: "#16181D", boxShadow: "0 18px 44px -20px rgba(20,24,32,0.55)" }}>
            <div className="flex items-center gap-2 px-4 py-3" style={{ backgroundColor: "#1F232A" }}>
              <span className="h-[11px] w-[11px] rounded-full" style={{ backgroundColor: "#FF5F57" }} />
              <span className="h-[11px] w-[11px] rounded-full" style={{ backgroundColor: "#FEBC2E" }} />
              <span className="h-[11px] w-[11px] rounded-full" style={{ backgroundColor: "#28C840" }} />
              <span className="ml-2 font-mono text-[11px]" style={{ color: "#8A9099" }}>terminal</span>
            </div>
            <pre
              className="overflow-x-auto p-5 font-mono text-[12px] leading-[1.75]"
              style={{ color: "#D3D7DE", margin: 0 }}
            >
              <code>
                {LINEAS_API(t).map((ln, i) => (
                  <span
                    key={i}
                    className="block"
                    style={{
                      // el escalonado hace que se lea como una respuesta que
                      // llega, no como un bloque de texto que aparece
                      opacity: dentro ? 1 : 0,
                      transform: dentro ? "none" : "translateY(5px)",
                      transition: `opacity 380ms ${EASE} ${i * 55}ms, transform 380ms ${EASE} ${i * 55}ms`,
                      minHeight: "1.75em",
                    }}
                  >
                    {ln}
                  </span>
                ))}
              </code>
            </pre>
          </div>
        </div>
  );
}

// ── EL MODELO APRENDE ───────────────────────────────────────────────
// Comparativa de mora por cohorte. VERIFICADO contra la DB de producción el
// 2026-08-11 (query read-only sobre loans agrupado por mes de originación):
//   dic-2025  924 préstamos · 331 en mora · 35.8%
//   may-2026  619 · 61 ·  9.9%      jun-2026  429 · 55 · 12.8%
//   → cohortes maduras recientes (may+jun): 116/1048 = 11.1%
//
// Julio y agosto quedan FUERA a propósito: sus préstamos todavía no vencieron
// todos, así que su mora está subestimada y meterlos exageraría la mejora.
// Esa es la diferencia entre mostrar el dato y elegirlo.
const COHORTES: { et: string; pct: number; n: string; fuerte?: boolean; final?: boolean }[] = [
  { et: "Primera cohorte\ndic 2025", pct: 35.8, n: "924 préstamos", fuerte: true },
  { et: "Promedio 2026", pct: 17.3, n: "2.835 préstamos" },
  { et: "Cohortes maduras\nmay–jun 2026", pct: 11.1, n: "1.048 préstamos", final: true },
];

function ModeloAprende() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // COLUMNAS y no barras ni anillos. El dato es una serie temporal, y las
  // columnas de izquierda a derecha se leen como línea de tiempo; tres
  // círculos no tienen orden implícito. Además comparar alturas es trivial
  // —el argumento es "baja", y la escalera descendente lo dice antes de leer
  // un número— mientras que comparar el llenado de tres arcos no lo es. Y el
  // arco ya significa SCORE en esta página: reusarlo acá emborrona el
  // vocabulario.
  const ALTO = 190;
  return (
    <div ref={ref}>
      <div className="mx-auto max-w-[52ch] text-center">
        <Kicker center>{t("El modelo aprende", "The model learns")}</Kicker>
        <h2
          className="mx-auto mt-4 font-bold tracking-tight"
          style={{ color: INK_TIT, fontSize: "clamp(1.95rem, 3.4vw, 3rem)", lineHeight: 1.05 }}
        >
          {t("La mora baja con cada cohorte.", "Delinquency falls with every cohort.")}
        </h2>
        <p className="mx-auto mt-5 max-w-[50ch] text-[16.5px] leading-relaxed" style={{ color: INK_65 }}>
          {t(
            "Cada repago entra al modelo. Un buró te da una foto fija de hace seis meses; esto se corrige solo, mes a mes.",
            "Every repayment feeds the model. A bureau gives you a six-month-old still photo; this corrects itself, month over month."
          )}
        </p>
      </div>

      <div className="mx-auto mt-12 max-w-[760px]">
        {/* El área del gráfico: las columnas se alinean al PISO y el % viaja
            pegado arriba de cada una. A altura fija los porcentajes quedaban
            flotando lejos de las columnas cortas y el ojo tenía que unirlos. */}
        <div className="relative grid grid-cols-3 gap-6 md:gap-10" style={{ height: ALTO + 78 }}>
          {COHORTES.map((c, i) => (
            <div key={c.et} className="flex flex-col items-center justify-end">
              <p
                className="mb-3 font-bold tracking-tight [font-variant-numeric:tabular-nums]"
                style={{
                  color: c.final ? ORANGE_DEEP : c.fuerte ? INK_45 : INK,
                  // grandes de verdad: el % ES el argumento de la sección, y
                  // a 1.95rem competía de igual a igual con la etiqueta
                  // el mínimo baja de 2.6/2rem a 1.5/1.25: en mobile cada
                  // columna mide ~110px y los números se montaban sobre las
                  // barras de al lado
                  fontSize: c.final ? "clamp(1.5rem, 4.6vw, 4rem)" : "clamp(1.25rem, 3.4vw, 3rem)",
                  lineHeight: 1,
                }}
              >
                {c.pct.toLocaleString("es-AR", { minimumFractionDigits: 1 })}%
              </p>
              <div
                className="w-full max-w-[92px] rounded-t-[10px]"
                style={{
                  height: visible ? (c.pct / 35.8) * ALTO : 0,
                  // Dos tonos y no tres: la historia es NEUTRO (lo que fue)
                  // → MARCA (lo que logramos). El naranja al 55% del medio se
                  // lavaba sobre el crema —naranja claro sobre fondo cálido
                  // claro— y el remate va en ORANGE_DEEP, que sobre esta
                  // superficie tiene bastante más peso que el #F97415.
                  backgroundColor: c.fuerte
                    ? "rgba(42,23,16,0.14)"
                    : c.final
                    ? ORANGE_DEEP
                    : "rgba(42,23,16,0.30)",
                  transition: `height 1000ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 150}ms`,
                }}
              />
            </div>
          ))}
          {/* una sola línea de base, continua: tres segmentos sueltos se leen
              como tres gráficos en vez de uno */}
          <div
            className="absolute inset-x-0 bottom-0"
            style={{ height: 1, backgroundColor: "rgba(42,23,16,0.14)" }}
            aria-hidden
          />
        </div>

        <div className="mt-3.5 grid grid-cols-3 gap-6 md:gap-10">
          {COHORTES.map((c) => (
            <div key={c.et} className="text-center">
              <p className="whitespace-pre-line text-[13px] leading-snug" style={{ color: c.final ? INK : INK_65 }}>
                {c.et}
              </p>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-9 text-center font-mono text-[11.5px] uppercase tracking-[0.12em] md:text-[10.5px]" style={{ color: META }}>
        {t("Mora por mes de originación · cohortes maduras", "Delinquency by origination month · matured cohorts")}
      </p>
    </div>
  );
}

// ── LO QUE PONEMOS (scrollytelling) ─────────────────────────────────
// Las tres patas y la curva viven en UN solo lienzo que queda fijo mientras
// scrolleás. El scroll no mueve la página: mueve el RELATO — se abre una
// pata por vez y, al final, las tres se apagan y aparece la curva que
// acumula todo lo dicho.
//
// El progreso sale de la posición de la sección en el scroller (#root),
// leído en rAF. Nada de listeners que recalculen layout por evento.
function LoQuePonemos({ side, entreMedio }: { side: Side; entreMedio?: ReactNode }) {
  const t = useT();
  const s = useProtocolStats();
  const ref = useRef<HTMLDivElement>(null);
  // El activo salía del progreso de scroll de la sección, pero la sección
  // dejó de ser alta (ya no hay sticky): total = alto − viewport daba ≤ 0,
  // así que p se quedaba clavado en 0 y la primera tarjeta no soltaba nunca
  // — trabada, y sin nada que hacerle click. Ahora rota sola en pantalla y
  // se puede tocar, que es lo que cualquiera intenta primero.
  const [activo, setActivo] = useState(0);
  const [enPantalla, setEnPantalla] = useState(false);
  const tocado = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // threshold 0 y NO 0.35: la sección es MÁS ALTA que el viewport, así que
    // su intersectionRatio nunca llega a 0.35 y enPantalla se quedaba en
    // false para siempre — la curva no se dibujaba nunca y las patas no
    // rotaban. Un umbral por porcentaje sólo sirve con elementos que entran
    // enteros en pantalla.
    const io = new IntersectionObserver(([e]) => setEnPantalla(e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!enPantalla || tocado.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setActivo((v) => (v + 1) % 3), 4200);
    return () => window.clearInterval(id);
  }, [enPantalla, activo]);
  // un click manda: se corta la rotación y queda donde el usuario la dejó
  const elegir = (i: number) => {
    tocado.current = true;
    setActivo(i);
  };

  const patas = [
    {
      k: t("El modelo", "The model"),
      titulo: t("Evaluamos sin buró", "We underwrite without a bureau"),
      cuerpo: t(
        "Leemos la huella que la persona ya generó y devolvemos un límite. Tu equipo no construye scoring.",
        "We read the footprint the person already generated and return a limit. Your team builds no scoring."
      ),
      valor: s.loans,
      sufijo: "",
      pie: t("evaluaciones hechas", "underwriting decisions"),
    },
    {
      k: t("El capital", "The capital"),
      titulo: t("La plata sale del vault", "The money comes from the vault"),
      cuerpo: t(
        "No hay capital tuyo en el pool. Si un préstamo entra en mora, la pérdida no toca tu tesorería.",
        "None of your capital sits in the pool. If a loan goes delinquent, the loss never touches your treasury."
      ),
      valor: Math.round(s.gmvK),
      sufijo: "k",
      prefijo: "$",
      pie: t("originados en USDC", "originated in USDC"),
    },
    {
      k: t("El riesgo", "The risk"),
      titulo: t("La cobranza es nuestra", "Collections are ours"),
      cuerpo: t(
        "Nosotros perseguimos el repago. Vos ponés la distribución y la experiencia; el riesgo queda de este lado.",
        "We chase the repayment. You bring distribution and the experience; the risk stays on our side."
      ),
      valor: s.repaidPct,
      sufijo: "%",
      pie: t("del capital ya volvió", "of capital already returned"),
    },
  ];

  // Tres tiempos, uno por pata. La curva NO es un cuarto tiempo que las
  // reemplaza: vive debajo, en el mismo lienzo, porque es el resumen de lo
  // que las tres acaban de decir — no otra pantalla.

  return (
    <section ref={ref} className="relative px-4 py-5 md:px-6">
      <div>
        <MarcoOscuro className="flex w-full flex-col px-6 py-14 md:px-12">
          <div className="mx-auto w-full max-w-[46ch] text-center">
            <Kicker center>{t("Lo que ponemos", "What we bring")}</Kicker>
            <h2
              className="mx-auto mt-4 font-bold tracking-tight"
              style={{ color: INK_TIT, fontSize: "clamp(1.95rem, 3.4vw, 3rem)", lineHeight: 1.05 }}
            >
              {t("Tres cosas que no tenés que construir.", "Three things you don't have to build.")}
            </h2>
          </div>

          <div className="mt-10">
            {/* gap-5 (20px), el MISMO que las tiles de prueba viva y las de
                /stats. Estaba en gap-3 y era el único grupo de tarjetas de la
                página con otra separación. Con el cuerpo colapsando a cero ya
                no hay riesgo de que las columnas más angostas estiren la
                fila, que es lo que obligaba a apretar el gap. */}
            <div className="flex flex-col gap-5 md:min-h-[420px] md:flex-row">
              {patas.map((pt, i) => {
                const on = activo === i;
                return (
                  <button
                    key={pt.k}
                    type="button"
                    onClick={() => elegir(i)}
                    aria-pressed={on}
                    className="relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-[26px] p-6 text-left md:p-8"
                    style={{
                      flex: on ? "2.6 1 0%" : "1 1 0%",
                      backgroundColor: on ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.70)",
                      boxShadow: on
                        ? "inset 0 0 0 1px rgba(20,109,250,0.16), 0 20px 44px -30px rgba(11,32,73,0.35)"
                        : "inset 0 0 0 1px rgba(20,109,250,0.09)",
                      // el blur de las tarjetas también se va en mobile: son
                      // tres, y cada una obliga a un repintado con lectura de
                      // fondo mientras la sección está en pantalla
                      ...(typeof window !== "undefined" && window.innerWidth < 900
                        ? null
                        : { backdropFilter: "blur(6px)" }),
                      transition: `flex 700ms ${EASE}, background-color 500ms ${EASE}, box-shadow 500ms ${EASE}`,
                    }}
                  >
                    <div>
                      <p className="font-mono text-[11.5px] font-medium uppercase tracking-[0.14em] md:text-[10.5px]" style={{ color: META }}>
                        0{i + 1} · {pt.k}
                      </p>
                      <h3
                        className="mt-3 font-bold tracking-tight"
                        style={{ color: INK, fontSize: on ? 24 : 18, lineHeight: 1.15, transition: `font-size 560ms ${EASE}` }}
                      >
                        {pt.titulo}
                      </h3>
                      {/* El cuerpo se colapsa a ALTURA CERO cuando la tarjeta
                          no está activa. Antes sólo bajaba a `opacity: 0`, y
                          un párrafo invisible SIGUE OCUPANDO SU ALTO: en las
                          dos tarjetas angostas el mismo texto envolvía en el
                          triple de líneas (71px activo → 212px colapsado a
                          768px de ancho), así que la fila entera se estiraba
                          y, como el alto dependía de CUÁL estaba angosta,
                          saltaba en cada rotación. Eso era el "se rompe cada
                          tanto".
                          El truco de grid 0fr→1fr anima el alto de verdad
                          (height:auto no es animable) sin fijar un máximo a
                          ojo que después se corte al cambiar el copy. */}
                      <div
                        className="grid"
                        style={{
                          gridTemplateRows: on ? "1fr" : "0fr",
                          transition: `grid-template-rows 520ms ${EASE}`,
                        }}
                      >
                        <div className="overflow-hidden">
                          <p
                            className="mt-3 max-w-[40ch] text-[14.5px] leading-relaxed"
                            style={{
                              color: INK_65,
                              opacity: on ? 1 : 0,
                              transform: on ? "none" : "translateY(6px)",
                              transition: `opacity 460ms ${EASE} 140ms, transform 460ms ${EASE} 140ms`,
                            }}
                          >
                            {pt.cuerpo}
                          </p>
                        </div>
                      </div>
                    </div>
                    <NumeroPata pata={pt} activo={on} />
                  </button>
                );
              })}
            </div>

          </div>

          {/* los pasos, como marcadores de avance */}
          <div className="mt-8 flex items-center justify-center gap-2">
            {[0, 1, 2].map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => elegir(i)}
                aria-label={`Ver ${i + 1} de 3`}
                // El punto mide 4px de alto: imposible de tocar. El área
                // táctil se agranda con padding y se compensa con margen
                // negativo, así el indicador se ve igual pero se puede pulsar.
                className="block cursor-pointer rounded-full border-0 px-1.5 py-3 [background-clip:content-box] -my-3"
                style={{
                  height: 28,
                  width: activo === i ? 30 : 14,
                  backgroundColor: activo === i ? ACCENT : "rgba(42,23,16,0.14)",
                  transition: `width 460ms ${EASE}, background-color 460ms ${EASE}`,
                }}
              />
            ))}
          </div>

          {/* La curva vive en el MISMO lienzo, separada por un hairline: es el
              resumen de lo que las tres patas acaban de decir. Dos lienzos
              seguidos partían el argumento en dos bloques sueltos. */}
          <div className="mt-24">
            <div className="mx-auto max-w-[46ch] text-center">
              <Kicker center>{t("La curva", "The curve")}</Kicker>
              <h3
                className="mx-auto mt-4 font-bold tracking-tight"
                style={{ color: INK_TIT, fontSize: "clamp(1.7rem, 2.8vw, 2.45rem)", lineHeight: 1.07 }}
              >
                {t("Y todo eso, acumulado.", "And all of it, cumulative.")}
              </h3>
            </div>
            <div className="mt-8">
              <Curva dibujar={enPantalla} />
            </div>
          </div>

        </MarcoOscuro>
      </div>

      {/* El hueco para el navy. Va acá y no al final: después de "tres cosas
          que no tenés que construir", la pregunta que aparece es "¿y cuánto me
          lleva ponerlo?" — y "de la integración al primer préstamo, en
          semanas" la contesta exactamente. Al final quedaba después de tres
          lienzos, cuando el lector ya decidió. */}
      {/* -mx cancela el padding de ESTA sección: el navy es un Panel, que
          trae su propio px-4/md:px-6, y anidado acá lo recibía dos veces —
          por eso su borde quedaba más adentro que el de los lienzos azules. */}
      {/* mt-5 (20px): el navy trae 20px propios de padding, así que 20+20
          cierra los mismos 40px de hueco que hay entre todos los lienzos. */}
      <div className="-mx-4 mt-5 md:-mx-6">{entreMedio}</div>

      {/* Segundo lienzo. Los cuatro bloques en uno solo era demasiado peso
          para un mismo respiro: el primero dice QUÉ ponemos (las tres patas y
          la curva que las resume) y el segundo dice CÓMO mejora (la mora por
          cohorte y de qué está hecho el circuito). Son dos ideas, y ahora se
          leen como dos. */}
      {/* mt-5: el navy que viene arriba ya aporta sus 20px de padding
          inferior, así que 20+20 = los mismos 40px que el resto. Con mt-10
          este hueco daba 60 y era el más grande de la página. */}
      <div className="mt-5">
        {/* CÁLIDO COMPLETO Y QUIETO: el tercer pintado de la página. La onda
            del hero congelada — pintado como los extremos pero sin moverse,
            que es la distinción que los mantiene especiales. Entre los dos
            fríos, restaura la alternancia: vivo/frío/cálido/respiro/frío/vivo.
            La tarjeta navy contrasta igual de fuerte sobre crema. */}
        {/* Del lado fintech el cálido lo toma la INTEGRACIÓN y la mora se va
            al respiro de abajo. Del lado supplier no hay endpoint que
            integrar, así que la mora se queda acá y el respiro no se
            renderiza — ningún lienzo queda vacío. */}
        <MarcoOscuro calido className="flex w-full flex-col px-6 py-14 md:px-12">
          {side === "fintech" ? (
            <>
              {/* La mora ABRE el lienzo y el terminal cierra: el gráfico es
                  el argumento (el modelo mejora) y el endpoint es el detalle
                  de cómo se accede a él. Además el gráfico entra en blanco
                  sobre el crema, mientras el terminal oscuro es un peso que
                  conviene tener al final y no partiendo la sección al medio. */}
              <ModeloAprende />
              <div className="mt-20">
                <IntegracionCuerpo />
              </div>
            </>
          ) : (
            <ModeloAprende />
          )}
        </MarcoOscuro>
      </div>

      {/* El ecosistema pasa al FRÍO (antes compartía el cálido con la mora):
          su contenido son el score y el límite — números — y así la secuencia
          vuelve a alternar temperatura lienzo a lienzo. */}
      <div className="mt-10">
        <MarcoOscuro className="flex w-full flex-col px-6 py-14 md:px-12">
          {/* La PRUEBA primero y el mecanismo después. El orden anterior era
              mecanismo → evidencia, pero a esta altura el lector ya entendió
              qué ofrecemos y la pregunta que tiene es "¿esto funciona?" — no
              "¿cómo está cableado?". Los números contestan eso en dos
              segundos; el diagrama pide que lo estudies.
              Además le da sentido al diagrama: primero te convenzo de que
              anda, después te muestro cómo. Y el diagrama no pierde: deja de
              ser una barrera para el que todavía no se enganchó y pasa a ser
              la recompensa del que sí. */}
          <PruebaViva />
          <div className="mt-20">
            <FlujoInterior />
          </div>
        </MarcoOscuro>
      </div>
    </section>
  );
}

// casi arrastrándose, como se lee un contador de verdad. Con una cúbica
// todavía llegaba de golpe al número.
function useConteo(objetivo: number, activo: boolean, ms = 1700) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!activo) return setV(0);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setV(objetivo);
    let raf = 0;
    let t0 = 0;
    const paso = (ts: number) => {
      if (!t0) t0 = ts;
      const p = Math.min(1, (ts - t0) / ms);
      setV(Math.round(objetivo * (1 - Math.pow(1 - p, 5))));
      if (p < 1) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [objetivo, activo, ms]);
  return v;
}

function NumeroPata({
  pata,
  activo,
}: {
  pata: { valor: number; sufijo: string; prefijo?: string; pie: string };
  activo: boolean;
}) {
  const v = useConteo(pata.valor, activo);
  return (
    <div
      style={{
        opacity: activo ? 1 : 0,
        transform: activo ? "none" : "translateY(10px)",
        transition: `opacity 460ms ${EASE} 160ms, transform 460ms ${EASE} 160ms`,
      }}
    >
      <p
        className="font-bold tracking-tight [font-variant-numeric:tabular-nums]"
        style={{ color: INK, fontSize: "clamp(2.4rem, 4.4vw, 3.4rem)", lineHeight: 1 }}
      >
        {pata.prefijo ?? ""}
        {v.toLocaleString("es-AR")}
        {pata.sufijo}
      </p>
      <p className="mt-2 text-[13.5px]" style={{ color: INK_45 }}>
        {pata.pie}
      </p>
    </div>
  );
}

// ── PRE-LOADER ──────────────────────────────────────────────────────
// Panel naranja lleno con el mensaje, y después una cortina que SUBE.
//
// Cómo se hace el borde en escalera, que es lo que da el efecto: no son
// celdas que se apagan —eso se veía pixelado y era opacidad apareciendo de
// a saltos— sino COLUMNAS que se corren hacia arriba, cada una con su propio
// retraso. El escalón nace de la diferencia de avance entre columnas vecinas,
// así que el borde queda nítido y el movimiento es continuo. Además se anima
// transform, que va por compositor.
const PRE_COLS = 12;

function PreLoader() {
  const t = useT();
  const [barriendo, setBarriendo] = useState(false);
  const [entrado, setEntrado] = useState(false);
  const [fuera, setFuera] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setFuera(true);
      return;
    }
    // un frame después de montar, el texto pasa de desenfocado a nítido
    const tEntra = window.setTimeout(() => setEntrado(true), 60);

    // se va cuando las fuentes están listas o a los 1.3s, lo que pase antes:
    // sin esto el titular parpadea al pasar de la fuente del sistema a Inter,
    // que es justamente lo que el pre-loader viene a tapar.
    // Piso de lectura: aunque las fuentes vuelvan al instante, el mensaje se
    // queda ~1.1s. Si se va antes, el pre-loader es un parpadeo que molesta en
    // vez de cumplir su función.
    // Y espera además a que el primer lienzo haya PINTADO. Medido en frío:
    // los shaders linkean a ~1.7s y el primer draw cuesta ~460ms, o sea que
    // el tirón terminaba a ~2.27s contra un pre-loader que se iba a 2.35s:
    // andaba por 80ms de margen y en una máquina más lenta se veía. Con esta
    // espera el costo queda tapado siempre. El timeout de 2.6s es la red: si
    // el lienzo nunca avisa (WebGL deshabilitado), el pre-loader igual se va.
    const lienzoPintado = new Promise((r) => {
      const ok = () => { window.removeEventListener("lienzo-listo", ok); r(null); };
      window.addEventListener("lienzo-listo", ok);
      window.setTimeout(ok, 2600);
    });
    const listo = Promise.all([
      Promise.race([
        (document as Document & { fonts?: FontFaceSet }).fonts?.ready ?? Promise.resolve(),
        new Promise((r) => window.setTimeout(r, 1600)),
      ]),
      new Promise((r) => window.setTimeout(r, 1100)),
      lienzoPintado,
    ]);
    let t1 = 0, t2 = 0;
    listo.then(() => {
      t1 = window.setTimeout(() => setBarriendo(true), 240);
      t2 = window.setTimeout(() => setFuera(true), 240 + PRE_COLS * 55 + 900);
    });
    return () => {
      window.clearTimeout(tEntra);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  if (fuera) return null;

  return (
    <div className="fixed inset-0 z-[200] overflow-hidden" style={{ pointerEvents: barriendo ? "none" : "auto" }} aria-hidden>
      <div className="flex h-full w-full">
        {Array.from({ length: PRE_COLS }).map((_, i) => (
          <div
            key={i}
            className="h-full flex-1"
            style={{
              // #FB8A2E: la parada CLARA del gradiente del CTA en el kit, no
              // un naranja inventado. A pantalla completa el primario #F97415
              // pesa mucho más que en un botón —una superficie grande de color
              // saturado se percibe bastante más intensa que la misma tinta en
              // un área chica—, así que se usa el tono claro de la familia.
              backgroundColor: "#FB8A2E",
              transform: barriendo ? "translate3d(0,-101%,0)" : "none",
              // el retraso escalonado por columna es lo que dibuja la escalera
              transition: `transform 900ms cubic-bezier(0.65, 0, 0.35, 1) ${i * 55}ms`,
              willChange: "transform",
            }}
          />
        ))}
      </div>

      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center px-8"
        style={{
          opacity: barriendo ? 0 : 1,
          // entra desenfocado y enfoca; al salir se vuelve a desenfocar. El
          // blur va sólo en el texto (un elemento chico), no en superficies
          // grandes: ahí sí costaría caro.
          filter: barriendo ? "blur(14px)" : entrado ? "blur(0px)" : "blur(18px)",
          transform: barriendo ? "scale(1.04)" : entrado ? "scale(1)" : "scale(0.985)",
          transition:
            "opacity 340ms ease-out, filter 700ms cubic-bezier(0.16,1,0.3,1), transform 700ms cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <p
          className="text-center font-bold tracking-tight text-white"
          style={{ fontSize: "clamp(1.6rem, 3.4vw, 2.6rem)", letterSpacing: "-0.03em" }}
        >
          {t("cargando tu experiencia.", "loading your experience.")}
        </p>
      </div>
    </div>
  );
}

// ── MARCO DE LUZ ────────────────────────────────────────────────────
// El color vive en el BORDE y el centro queda limpio: el texto se lee sobre
// blanco y el encuadre lo da la luz, no una línea. Es la puerta leída como
// atmósfera — el resplandor entra por el filo del vano.
// Barato: el degradado no se anima (eso repinta), se anima el TRANSFORM de
// la capa, que va por compositor. El grano del kit va encima, estático.
function MarcoLuz({ children, className = "", side }: { children: ReactNode; className?: string; side: Side }) {
  return (
    <div
      className={`relative isolate overflow-hidden rounded-[26px] ${className}`}
      style={{
        // crema, no blanco: el mismo truco del celeste en los lienzos fríos —
        // sin huecos blancos, el lienzo es una superficie y la onda es luz
        backgroundColor: "#FFF5EE",
        backgroundImage:
          "radial-gradient(64% 58% at 50% 50%, rgba(255,255,255,0) 58%, rgba(249,116,21,0.05) 78%, rgba(249,116,21,0.16) 100%)",
      }}
    >
      <OndasLuz side={side} />
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.55]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: "140px 140px",
          mixBlendMode: "soft-light",
        }}
        aria-hidden
      />
      <div className="relative z-10 mx-auto w-full max-w-[1240px]">{children}</div>
    </div>
  );
}

// ── PROGRESO ────────────────────────────────────────────────────────
// Una línea de 2px al tope: cuánto queda. transform:scaleX en un rAF sobre
// el scroll de #root — compositor puro, cero layout. La única línea de la
// página, y se lo gana: es dato (posición), no decoración.
function BarraProgreso() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.getElementById("root");
    const el = ref.current;
    if (!root || !el) return;
    let raf = 0;
    const calc = () => {
      raf = 0;
      const total = root.scrollHeight - root.clientHeight;
      el.style.transform = `scaleX(${total > 0 ? root.scrollTop / total : 0})`;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(calc); };
    root.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    calc();
    return () => {
      root.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="fixed left-0 top-0 z-[60] h-[2px] w-full origin-left"
      style={{ backgroundColor: ACCENT, transform: "scaleX(0)" }}
      aria-hidden
    />
  );
}

// ── HERO (v4) ───────────────────────────────────────────────────────
// Sistema Aave, no CodeForge: sin rejilla de hairlines, sin cruces de
// registro, sin tira de features. Una sola columna centrada, mucho aire,
// tipografía grande y LIVIANA con tracking cerrado, y el producto —un
// teléfono— apoyado sobre un lavado cálido que muere en blanco.
// El switch de audiencia es la propia pastilla del eyebrow: dos elementos
// fundidos en uno para no sumar chrome.

// El score como protagonista: es lo que Lendoor hace y no se ve en ningún
// otro lado del hero. Arco + número + de qué está hecho, y recién después
// el límite que ese score habilita.
// La pantalla REAL del producto (la que ve el usuario dentro de Lemon), no
// una interpretación: el medidor con la rampa de la escala, el score, la
// fecha de actualización, las cuentas conectadas y el CTA. Replicarla es lo
// que hace que el hero muestre producto y no una ilustración.
function PantallaFintech() {
  const t = useT();
  const score = 645;
  const pct = score / 1000;

  // UN solo arco con el degradado corriendo por él, en vez de 46 rayitas: más
  // limpio y más fácil de leer de un vistazo. La rampa recorre la escala
  // entera 0→1000 y termina en el azul de la marca (#146DFA), pasando por
  // verde (~620) y teal (~800): el extremo alto queda en el color de la casa
  // en vez de un verde de semáforo.
  // AZUL, no la rampa multicolor. Un degradado rojo→verde se lee como medidor
  // de RIESGO, y acá el score es un activo, no una alarma — sobre todo en una
  // landing que lo vende como lo que la fintech no tiene que construir.
  // El azul además es el color funcional del kit para data-viz, y sobre la
  // página naranja es complementario: la pantalla del teléfono salta.
  // El degradado se queda dentro de la familia azul (claro→profundo): da
  // volumen sin sumar un matiz nuevo.
  const PARADAS: [number, string][] = [
    [0, "#5FA0FF"],
    [0.55, "#2C7CF7"],
    [1, "#1057D6"],
  ];
  const CX = 160, CY = 160, RG = 108;
  const D = `M${CX - RG} ${CY} A${RG} ${RG} 0 0 1 ${CX + RG} ${CY}`;
  const LARGO = Math.PI * RG;
  // El degradado es lineal en X, pero sobre un semicírculo la posición
  // horizontal no avanza al mismo ritmo que el ángulo (x = -R·cos θ). Sin
  // corregirlo, los colores se apelmazan en las puntas y se estiran en el
  // medio. Cada parada se reubica en (1-cos(tπ))/2, que es exactamente dónde
  // cae ese punto del arco sobre el eje X.
  const enX = (t: number) => (1 - Math.cos(t * Math.PI)) / 2;

  const cuentas: [string, string, string, boolean][] = [
    ["/lemon.png", "Lemon", "0x0963…2d16", true],
    ["/favicon.png", "Lendoor", "0xbb1b…1914", false],
    // MetaMask viene con el zorro a sangre: en un círculo se le cortaban las
    // orejas. Va cuadrado con radio, como en la app, y con un pelín de padding.
    ["/logos/metamask.svg", "Wallet", "0x4cc1…e185", false],
  ];

  return (
    // text-left explícito: el hero entero es text-center y la pantalla lo
    // heredaba, así que los nombres de las cuentas salían centrados.
    <div className="flex h-full flex-col px-5 pb-5 text-left">
      <p
        className="text-center font-mono text-[11px] font-bold uppercase tracking-[0.16em]"
        style={{ color: "#5B6472" }}
      >
        Lendoor Score
      </p>

      <div className="relative mx-auto mt-2 w-full max-w-[250px]">
        <svg viewBox="0 0 320 184" className="w-full overflow-visible" fill="none" aria-hidden>
          <defs>
            <linearGradient id="scoreRampa" gradientUnits="userSpaceOnUse" x1={CX - RG} y1="0" x2={CX + RG} y2="0">
              {PARADAS.map(([t, c]) => (
                <stop key={t} offset={enX(t)} stopColor={c} />
              ))}
            </linearGradient>
            {/* el bloom: el mismo arco difuminado debajo, para que el color
                parezca EMITIR en vez de estar pintado sobre el blanco */}
            <filter id="scoreBloom" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
          </defs>

          <path d={D} stroke="#E7E9ED" strokeWidth="26" strokeLinecap="round" />
          {/* El bloom va POR DEBAJO y más angosto que el arco nítido: antes
              tenía el mismo grosor, así que su borde difuminado asomaba por
              los costados y el arco entero se leía borroso. Ahora el halo
              queda escondido detrás y sólo aporta el color que "sale". */}
          <path
            d={D}
            stroke="url(#scoreRampa)"
            strokeWidth="18"
            strokeLinecap="round"
            strokeDasharray={`${pct * LARGO} ${LARGO}`}
            filter="url(#scoreBloom)"
            opacity="0.42"
          />
          <path
            d={D}
            stroke="url(#scoreRampa)"
            strokeWidth="26"
            strokeLinecap="round"
            strokeDasharray={`${pct * LARGO} ${LARGO}`}
          />
        </svg>
        <div className="absolute inset-x-0 bottom-[8%] text-center">
          <p className="font-bold tracking-tight" style={{ color: "#22303F", fontSize: 46, lineHeight: 1, letterSpacing: "-0.035em" }}>
            {score}
          </p>
          <p className="text-[13px]" style={{ color: "#7A8496" }}>
            {t("de 1000", "of 1000")}
          </p>
        </div>
      </div>

      <p className="mt-2 text-center text-[12px]" style={{ color: "#7A8496" }}>
        {t("Última actualización: 13/08/2026", "Last update: 08/13/2026")}
      </p>

      <p
        className="mt-5 text-center font-mono text-[11px] font-bold uppercase tracking-[0.14em]"
        style={{ color: "#5B6472" }}
      >
        {t("Cuentas conectadas", "Connected accounts")}
      </p>

      <div className="mt-3 rounded-2xl px-3.5" style={{ backgroundColor: "#F6F7F9" }}>
        {cuentas.map(([src, nom, addr, redondo], i) => (
          <div
            key={nom}
            className="flex items-center gap-3 py-3.5"
            style={i ? { borderTop: "1px solid rgba(42,23,16,0.07)" } : undefined}
          >
            <img
              src={src}
              alt=""
              className={`h-[32px] w-[32px] shrink-0 bg-white object-contain p-[3px] ${redondo ? "rounded-full" : "rounded-lg"}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold leading-tight" style={{ color: "#2C3A4B" }}>
                {nom}
              </p>
              <p className="mt-0.5 font-mono text-[11px] leading-tight" style={{ color: "#8A94A6" }}>
                {addr}
              </p>
            </div>
            <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden>
              <circle cx="10" cy="10" r="8.5" stroke="#1ABE3E" strokeWidth="1.5" />
              <path d="M6.2 10.3l2.6 2.5 5-5.2" stroke="#1ABE3E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        ))}
      </div>

    </div>
  );
}

// Marco de teléfono de verdad: banda metálica (doble borde interior: un
// highlight claro afuera y negro adentro), esquinas squircle por radio
// elíptico, botones que sobresalen y sombra de apoyo. Lo que se veía de
// cartón era un rectángulo negro con radio parejo y sin banda.
function TelefonoHero({ side }: { side: Side }) {
  const t = useT();
  return (
    // 324: el ancho de la referencia (Aave). 344 se sentía macizo y a la vez
    // deja menos aire a los costados cuando la ventana se angosta — con 324
    // el mockup respira mejor y el hero aguanta más reducción antes de que
    // haya que reacomodar nada.
    <div className="relative" style={{ width: 324 }}>
      {/* botones laterales */}
      <div className="absolute -left-[3px] top-[16.5%] h-[3.2%] w-[3px] rounded-l-md bg-[#3a3b3f]" aria-hidden />
      <div className="absolute -left-[3px] top-[23%] h-[6.5%] w-[3px] rounded-l-md bg-[#3a3b3f]" aria-hidden />
      <div className="absolute -left-[3px] top-[31.5%] h-[6.5%] w-[3px] rounded-l-md bg-[#3a3b3f]" aria-hidden />
      <div className="absolute -right-[3px] top-[26%] h-[10.5%] w-[3px] rounded-r-md bg-[#3a3b3f]" aria-hidden />

      <div
        className="relative w-full overflow-hidden bg-[#0e0f11]"
        style={{
          // El aspecto REAL de un iPhone. El teléfono no se achata: se CORTA
          // por abajo (ver el contenedor del hero), como en Aave — el aparato
          // sangra por el borde de la tarjeta en vez de terminar dentro.
          aspectRatio: "0.487",
          borderRadius: "18.5% / 9%",
          padding: "3.2%",
          // Sombra ÚNICA, suave y cálida. Eran dos capas oscuras al 40% y 28%
          // que sobre el fondo naranja se leían como un halo negro sucio
          // alrededor del teléfono. Una sola, más abierta y en la familia
          // cálida del fondo, apoya el objeto sin ensuciar.
          boxShadow:
            "0 34px 70px -34px rgba(120,60,20,0.30), inset 0 0 0 2px #4b4c51, inset 0 0 0 5px #0a0a0c",
        }}
      >
        <div className="relative h-full w-full overflow-hidden bg-white" style={{ borderRadius: "16% / 7.8%" }}>
          {/* barra de estado */}
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-[9%] pt-[3.4%]">
            <span className="text-[10px] font-semibold" style={{ color: "#111" }}>
              10:24
            </span>
            <svg viewBox="0 0 62 12" className="w-[22%]" fill="#111" aria-hidden>
              <rect x="0" y="7" width="3" height="5" rx="1" />
              <rect x="5" y="5" width="3" height="7" rx="1" />
              <rect x="10" y="3" width="3" height="9" rx="1" />
              <rect x="15" y="1" width="3" height="11" rx="1" />
              <path d="M29 4.5c2.6-2.4 6.4-2.4 9 0l-1.6 1.7c-1.7-1.5-4.1-1.5-5.8 0L29 4.5zm2.9 3c1-.9 2.5-.9 3.5 0L33.5 9.7 31.9 7.5z" />
              <rect x="44" y="1.5" width="15" height="9" rx="2.5" fill="none" stroke="#111" strokeWidth="1" opacity="0.5" />
              <rect x="45.5" y="3" width="10" height="6" rx="1.5" />
              <path d="M60.5 4.5v3c1-.3 1-2.7 0-3z" opacity="0.5" />
            </svg>
          </div>

          {/* Dynamic Island con la cámara */}
          <div
            className="absolute left-1/2 z-20 -translate-x-1/2 rounded-full bg-black"
            style={{ top: "1.8%", width: "27%", height: "3.4%" }}
            aria-hidden
          >
            <div
              className="absolute right-[10%] top-1/2 aspect-square -translate-y-1/2 rounded-full"
              style={{ height: "58%", background: "radial-gradient(circle at 35% 35%, #2a3350, #0a0d18 70%)" }}
            />
          </div>

          {/* la barra de la app anfitriona: el crédito es UNA pantalla más */}
          <div
            className="absolute inset-x-0 z-10 flex items-center justify-between px-5 pb-2"
            style={{ top: "7.4%", borderBottom: `1px solid ${INK_10}` }}
          >
            <span className="text-[11.5px] font-semibold" style={{ color: INK_65 }}>
              ← {t("Tu app", "Your app")}
            </span>
            <span className="font-mono text-[8.5px] uppercase tracking-[0.12em]" style={{ color: META }}>
              {t("Crédito", "Credit")}
            </span>
          </div>

          <div className="absolute inset-x-0 bottom-0" style={{ top: "12.5%" }}>
            {side === "fintech" ? <PantallaFintech /> : <PantallaFarm />}
          </div>
        </div>
      </div>
    </div>
  );
}

function PantallaFarm() {
  const t = useT();
  return (
    <div className="flex h-full flex-col px-4 pb-4 pt-3">
      <p style={{ fontSize: 10, letterSpacing: "0.14em", color: META }} className="font-mono uppercase">
        {t("Tu posición", "Your position")}
      </p>
      <p className="mt-1.5 font-bold tracking-tight" style={{ color: INK, fontSize: 34, lineHeight: 1 }}>
        $1.011<span style={{ color: INK_45 }}>,20</span>
      </p>
      <p className="mt-1 text-[11.5px]" style={{ color: INK_65 }}>
        <b style={{ color: "#15803D" }}>+$11,20</b> {t("en 30 días", "in 30 days")}
      </p>

      <div className="mt-5 flex h-12 items-end gap-[3px]">
        {[26, 38, 32, 50, 44, 58, 53, 70, 64, 82, 76, 100].map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-[2px]"
            style={{ height: `${h}%`, backgroundColor: i > 8 ? ACCENT : "rgba(249,116,21,0.26)" }}
          />
        ))}
      </div>
      <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em]" style={{ color: META }}>
        {t("Interés cobrado por semana", "Interest collected per week")}
      </p>

      <div className="mt-auto">
        <div className="flex items-center justify-between py-2" style={{ borderTop: `1px solid ${INK_10}` }}>
          <span className="text-[13px]" style={{ color: INK_65 }}>
            {t("Depositaste", "You deposited")}
          </span>
          <span className="font-mono text-[12px] font-bold" style={{ color: INK }}>
            $1.000,00
          </span>
        </div>
        <div className="flex items-center justify-between py-2" style={{ borderTop: `1px solid ${INK_10}` }}>
          <span className="text-[13px]" style={{ color: INK_65 }}>
            {t("Interés", "Interest")}
          </span>
          <span className="font-mono text-[12px] font-bold" style={{ color: "#15803D" }}>
            +$11,20
          </span>
        </div>
      </div>
    </div>
  );
}


function Hero({ side, onSide }: { side: Side; onSide: (s: Side) => void }) {
  const t = useT();
  // El contenido viaja hacia el lado del botón que tocaste: sale por un
  // costado y el nuevo entra por el otro. Es lo que hace que se lea como
  // DOS LADOS de lo mismo y no como dos páginas sueltas.
  //
  // `visible` es lo que se está mostrando; `side` es lo que pediste. La
  // diferencia entre los dos es la que dispara la animación.
  const [visible, setVisible] = useState<Side>(side);
  const [fase, setFase] = useState<"quieto" | "sale" | "entra">("quieto");
  const dir = useRef(1); // +1 hacia suppliers (derecha), -1 hacia fintechs
  const visRef = useRef(visible);
  visRef.current = visible;

  useEffect(() => {
    if (side === visRef.current) return;
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (quieto) return setVisible(side);
    dir.current = side === "farm" ? 1 : -1;
    setFase("sale");
    const t1 = window.setTimeout(() => {
      setVisible(side);
      setFase("entra"); // aparece del otro lado, todavía invisible
      requestAnimationFrame(() => requestAnimationFrame(() => setFase("quieto")));
    }, 260);
    return () => window.clearTimeout(t1);
  }, [side]);

  const c = useCopy(visible);
  const D = dir.current;
  const anim: React.CSSProperties =
    fase === "sale"
      ? { opacity: 0, transform: `translateX(${-D * 30}px)`, transition: `opacity 260ms ${EASE}, transform 260ms ${EASE}` }
      : fase === "entra"
      ? { opacity: 0, transform: `translateX(${D * 30}px)`, transition: "none" }
      : { opacity: 1, transform: "none", transition: `opacity 540ms ${EASE}, transform 540ms ${EASE}` };
  return (
    // pb-5 (20px) para cerrar igual que abre cualquier otra sección: sin
    // padding inferior, el hueco al lienzo siguiente daba 20 en vez de 40.
    <section className="px-4 pb-5 pt-2 md:px-6 md:pt-2.5">
      {/* pb-0 del lado fintech: el teléfono se corta al ras del borde de la
          tarjeta (el patrón de Aave). Con pb-14 quedaba una franja naranja
          debajo del corte y el aparato parecía flotar adentro en vez de
          sangrar. Del lado supplier el globo sí necesita su aire. */}
      <MarcoLuz
        side={visible}
        className={`${SEC_X} pt-8 text-center md:pt-9 ${visible === "fintech" ? "pb-0" : "pb-14"}`}
      >
        {/* El switch ES el eyebrow: una pastilla, dos funciones. */}
        {/* El switch: pastilla clara con un pulgar BLANCO que se desliza, no un
            bloque negro. El bloque oscuro pesaba como un botón primario y
            competía con el CTA; acá lo que llama la atención es el punto de
            color, que además SIGNIFICA algo: toma la temperatura del lado
            elegido (cálido para la app, frío para el capital), la misma que
            el fondo del hero. El control te dice en qué mundo estás. */}
        <div
          className="relative inline-flex rounded-full p-1"
          role="group"
          aria-label={t("Elegí tu lado", "Pick your side")}
          style={{
            backgroundColor: "rgba(255,255,255,0.55)",
            boxShadow: `inset 0 0 0 1px ${INK_10}`,
            ...(typeof window !== "undefined" && window.innerWidth < 900
              ? null
              : { backdropFilter: "blur(10px)" }),
          }}
        >
          <span
            aria-hidden
            className="absolute rounded-full"
            style={{
              top: 4,
              bottom: 4,
              left: 4,
              width: "calc(50% - 4px)",
              backgroundColor: "#fff",
              // La pastilla se TIÑE del lado al que va: halo cálido hacia la
              // app, frío hacia el capital. El cambio de color viaja junto con
              // el deslizamiento, así el gesto se anticipa antes de terminar.
              boxShadow:
                side === "farm"
                  ? "0 1px 2px rgba(42,23,16,0.10), 0 6px 18px -8px rgba(27,71,171,0.45), inset 0 0 0 1px rgba(27,71,171,0.16)"
                  : "0 1px 2px rgba(42,23,16,0.10), 0 6px 18px -8px rgba(249,116,21,0.50), inset 0 0 0 1px rgba(249,116,21,0.18)",
              transform: side === "farm" ? "translateX(100%)" : "translateX(0)",
              // cubic con overshoot leve: la pastilla "aterriza" en vez de
              // frenar, que es lo que hace que dé ganas de volver a tocarla
              transition: "transform 520ms cubic-bezier(0.34, 1.32, 0.42, 1), box-shadow 420ms ease",
            }}
          />
          {([
            ["fintech", t("Para fintechs", "For fintechs")],
            ["farm", t("Para suppliers", "For suppliers")],
          ] as [Side, string][]).map(([k, label]) => {
            const active = side === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => onSide(k)}
                aria-pressed={active}
                // py-3 en mobile: a py-1.5 el botón medía 32px de alto y el
                // mínimo táctil son 44. En desktop no hace falta y ocupa aire.
                className="relative z-10 flex flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full px-7 py-3 text-[13px] md:py-1.5"
                style={{
                  border: 0,
                  background: "transparent",
                  color: active ? INK : INK_45,
                  fontWeight: active ? 600 : 500,
                  transition: `color 320ms ${EASE}`,
                }}
              >
                <span
                  aria-hidden
                  className="inline-block rounded-full"
                  style={{
                    width: 6,
                    height: 6,
                    // el punto toma la temperatura del lado: naranja para la
                    // app, azul para el capital
                    backgroundColor: active ? (k === "farm" ? "#1B47AB" : ACCENT) : "rgba(42,23,16,0.18)",
                    transform: active ? "scale(1)" : "scale(0.7)",
                    transition: `background-color 320ms ${EASE}, transform 320ms ${EASE}`,
                  }}
                />
                {label}
              </button>
            );
          })}
        </div>

        {/* Titular grande y LIVIANO, tracking cerrado (Aave), con el acento
            serif del kit. */}
        <div style={anim}>
        <h1
          className="mx-auto mt-6 max-w-[17ch]"
          style={{
            color: INK,
            fontWeight: 600,
            fontSize: "clamp(2.9rem, 6.4vw, 4.6rem)",
            letterSpacing: "-0.042em",
            lineHeight: 1.02,
          }}
        >
          {c.headA}
          <Accent>{c.accent}</Accent>
          <br />
          {c.headB}
        </h1>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Cta href="#acceso" size="lg">
            {t("Solicitar acceso", "Request access")}
          </Cta>
          {/* Usa el MISMO componente que el resto (variante suave) en vez de
              un botón dibujado a mano con otro borde y otra sombra.
              Y el destino cambia con la audiencia: la fintech baja a la
              prueba viva de esta página; el supplier va a /stats, que es el
              vault en vivo — para él, "los números" son los del pool, y
              además #prueba ya no existe de ese lado. */}
          {/* Siempre a /stats, de los dos lados: son LOS números del
              protocolo, en vivo y verificables. Del lado fintech mandaba a
              #prueba, que es un resumen de tres cifras dentro de la misma
              página — menos de lo que el botón promete. */}
          <Cta variante="suave" size="lg" href="/stats">
            {t("Ver los números", "See the numbers")}
          </Cta>
        </div>
        </div>

        {/* El visual cambia con la audiencia, no sólo el texto: la fintech
            ve el PRODUCTO (una pantalla adentro de su app); el que pone
            capital ve DÓNDE trabaja su plata. Dos preguntas distintas, dos
            respuestas distintas. */}
        {/* Altura FIJA y overflow-hidden: el teléfono conserva su aspecto real
            y el contenedor lo corta justo después del CTA "Pedir $30", así el
            aparato sangra por el borde inferior de la tarjeta (el patrón de
            Aave) en vez de quedar entero con aire muerto abajo. 520 llega
            hasta el CTA "Mejorar score", que es donde la pantalla cierra su
            idea; cortar antes dejaba la lista de cuentas colgando. */}
        <div
          className="mt-10 flex justify-center overflow-hidden"
          style={{
            // El teléfono SÍ lleva altura fija: se corta a propósito y el
            // recorte tiene que caer siempre en el mismo lugar.
            // El globo NO: es cuadrado y se autodimensiona (w-full con
            // aspect 1/1 y tope de 880), así que la altura la da su propio
            // contenido. Fijada en 900 se veía bien en desktop pero en un
            // viewport de 390 el globo mide ~334 y sobraban 560px de vacío
            // adentro de la tarjeta.
            height: visible === "fintech" ? 520 : undefined,
            minHeight: undefined,
            transition: `height 460ms ${EASE}, min-height 460ms ${EASE}`,
          }}
        >
          <div style={anim}>
            {visible === "fintech" ? <TelefonoHero side={visible} /> : <GloboSesiones />}
          </div>
        </div>
      </MarcoLuz>
    </section>
  );
}

// EL MOCKUP DE SIEMPRE — el mismo que usa la v2: bezel oscuro con doble
// borde, Dynamic Island con cámara, status bar y botones laterales. Entero y
// centrado debajo del título, sin recortes ni inclinaciones.




// ── VISUALES DE FILA ────────────────────────────────────────────────
// Cada uno tiene que parecer un pedazo de producto, no una ilustración. Es
// la diferencia entre "te cuento qué hace" y "mirá qué hace".

// ⚠️ CIFRAS A VERIFICAR CONTRA PROD antes de publicar (§6).
function TablaPrueba() {
  const t = useT();
  const [caja, dentro] = useRevela<HTMLDivElement>();
  // EN VIVO, del mismo hook que las tres patas. Estaban hardcodeadas en
  // 4.546 y 1.155 mientras las patas leían la API: la misma página mostraba
  // el mismo dato con dos valores distintos (hoy 4.625 y 1.156). Un CTO que
  // lee los dos lo nota, y es el tipo de detalle que hace dudar del resto.
  const st = useProtocolStats();
  const miles = (n: number) => n.toLocaleString("es-AR");
  // Cifras verificadas contra la DB de producción el 2026-08-03 (query read-only):
  // loans 4.546 · repaid_on_time 2.754 · borrowers distintos 1.155 · países
  // con préstamos por lemonCountry 4 (AR/PE/CO/BR).
  // Estilo Aave: tarjeta blanca, glifo en acento arriba, número grande,
  // leyenda gris — cuatro en una fila. Los glifos son geometría mínima
  // (nada de librería de íconos por cuatro dibujos).
  const filas: { v: string; k: string; glifo: ReactNode }[] = [
    {
      v: miles(st.loans),
      k: t("Préstamos originados.", "Loans originated."),
      glifo: <path d="M4 20 L4 6 H13 V18 H17" stroke={ACCENT} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
    },
    {
      // La API pública no expone el conteo de repagos a tiempo (sí el
      // principal repagado), así que esta sale de la proporción verificada
      // contra la DB el 2026-08-03: 2.754 de 4.546 = 60.6% de los préstamos.
      // Aplicada al total en vivo, no se desfasa de las otras dos.
      v: miles(Math.round(st.loans * 0.606)),
      k: t("Repagados a tiempo.", "Repaid on time."),
      glifo: <path d="M4 12.5l4.5 4.5L20 6.5" stroke={ACCENT} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
    },
    {
      v: miles(st.borrowers),
      k: t("Usuarios con línea abierta.", "Users with an open line."),
      glifo: (
        <>
          <circle cx="9" cy="9" r="3.6" stroke={ACCENT} strokeWidth="2.4" fill="none" />
          <path d="M3.5 20c1.2-3.4 3.2-5 5.5-5s4.3 1.6 5.5 5" stroke={ACCENT} strokeWidth="2.4" strokeLinecap="round" fill="none" />
          <circle cx="17.5" cy="10" r="2.6" stroke={ACCENT} strokeWidth="2.2" fill="none" opacity="0.55" />
        </>
      ),
    },
  ];
  return (
    // Como Aave: las tarjetas no se estiran hasta los bordes — un max-width
    // contenido y aire generoso a los costados. El salto a 3 columnas recién
    // en md: en sm tres tarjetas quedaban de 200px y el número no entraba.
    <div ref={caja} className="mx-auto grid w-full max-w-[1080px] grid-cols-1 gap-5 md:grid-cols-3">
      {filas.map(({ v, k, glifo }, i) => (
        <div
          key={k}
          className="rounded-[18px] bg-white px-7 pb-8 pt-7"
          style={{
            boxShadow: "0 14px 34px -22px rgba(11,32,73,0.35)",
            opacity: dentro ? 1 : 0,
            transform: dentro ? "none" : "translateY(16px)",
            transition: `opacity 560ms ${EASE} ${i * 110}ms, transform 560ms ${EASE} ${i * 110}ms`,
          }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>{glifo}</svg>
          <p
            className="mt-10 font-bold tracking-tight [font-variant-numeric:tabular-nums]"
            style={{ color: INK_TIT, fontSize: "clamp(1.9rem, 2.6vw, 2.4rem)", lineHeight: 1 }}
          >
            {v}
          </p>
          <p className="mt-2.5 text-[14.5px]" style={{ color: INK_65 }}>{k}</p>
        </div>
      ))}
    </div>
  );
}

// ── LA REJILLA ──────────────────────────────────────────────────────
// El sistema estructural que nos faltaba. CodeForge divide la página con
// hairlines y marca las intersecciones con cruces de registro (+), como una
// hoja de imprenta. Es barato y hace la diferencia entre "secciones apiladas"
// y "página compuesta".
//
// Nuestra versión: las cruces se dibujan con el naranja de marca en vez de
// gris, así el device también es nuestro.
function Cruz({ className = "" }: { className?: string }) {
  return (
    <span className={`pointer-events-none absolute z-20 ${className}`} aria-hidden>
      <span className="absolute left-1/2 top-1/2 h-[9px] w-px -translate-x-1/2 -translate-y-1/2" style={{ backgroundColor: "rgba(249,116,21,0.45)" }} />
      <span className="absolute left-1/2 top-1/2 h-px w-[9px] -translate-x-1/2 -translate-y-1/2" style={{ backgroundColor: "rgba(249,116,21,0.45)" }} />
    </span>
  );
}

// Mapa punteado de LATAM — el equivalente honesto al "activo en 120 países".
// Nosotros estamos en dos, así que el mapa no presume alcance: muestra dónde
// SÍ estamos, y el resto queda como puntos apagados.
// MAPA MUNDIAL punteado (como la referencia): continentes como polígonos en
// lon/lat reales, proyección equirrectangular. Aproximados a mano pero
// RECONOCIBLES a la resolución de la trama (~3px por punto).
const CONTINENTES: [number, number][][] = [
  // Norteamérica
  [[-165, 65], [-130, 70], [-90, 72], [-70, 62], [-55, 52], [-65, 45], [-75, 35], [-80, 25], [-88, 16], [-95, 16], [-105, 22], [-117, 33], [-125, 45], [-150, 60]],
  // Groenlandia
  [[-52, 82], [-25, 82], [-20, 70], [-45, 60], [-55, 70]],
  // Sudamérica
  [[-80, 9], [-62, 10], [-50, 0], [-35, -6], [-38, -18], [-52, -28], [-60, -38], [-66, -54], [-72, -46], [-70, -30], [-77, -15], [-81, -4]],
  // Europa
  [[-9, 55], [3, 60], [12, 64], [28, 70], [42, 66], [46, 52], [30, 45], [22, 38], [2, 38], [-9, 43]],
  // África
  [[-15, 32], [0, 36], [20, 32], [35, 30], [43, 10], [50, 2], [40, -14], [32, -28], [20, -34], [12, -20], [8, -4], [-8, 4], [-17, 14]],
  // Asia
  [[46, 52], [42, 66], [60, 73], [95, 76], [125, 72], [150, 66], [178, 64], [170, 55], [140, 45], [128, 36], [122, 24], [108, 10], [100, 4], [94, 14], [80, 7], [70, 20], [58, 24], [46, 36]],
  // Australia
  [[114, -20], [125, -12], [142, -10], [152, -25], [148, -38], [134, -35], [114, -33]],

  // ── ISLAS ─────────────────────────────────────────────────────────
  // Faltaban por completo, y no era sólo cosmético: tenemos una sesión real en
  // JAPÓN (lon 138, lat 36) y su punto quedaba flotando sobre el océano. Estas
  // son las masas que el ojo busca al mirar un planisferio; sin ellas el globo
  // se lee como un boceto en vez de un mapa.
  // Japón
  [[130, 31], [132, 34], [137, 35], [141, 41], [145, 44], [141, 45], [139, 41], [135, 34], [131, 33]],
  // Islas británicas
  [[-6, 50], [-3, 54], [-2, 58], [-5, 58], [-6, 55], [-10, 54], [-10, 51], [-6, 51]],
  // Indonesia + Filipinas
  [[95, 5], [105, 0], [115, -3], [125, -6], [135, -4], [140, -6], [130, -8], [118, -9], [106, -7], [96, 2]],
  [[120, 6], [124, 10], [122, 16], [120, 18], [118, 14], [119, 8]],
  // Nueva Zelanda
  [[172, -41], [175, -37], [178, -38], [176, -41], [172, -45], [167, -46], [169, -43]],
  // Madagascar
  [[43, -12], [50, -15], [50, -20], [47, -25], [44, -21], [43, -16]],
  // Caribe (Cuba + La Española)
  [[-85, 22], [-77, 20], [-74, 20], [-77, 23], [-83, 23]],
  [[-74, 18], [-68, 18], [-68, 20], [-72, 20]],
  // Sri Lanka
  [[80, 6], [82, 8], [81, 10], [79, 9], [79, 7]],
];

// lon/lat → % del lienzo (recorte lat 85°N a 60°S, sin Antártida)
// Ventana del mapa CENTRADA en las Américas (decisión Fabián 08-04): el
// mundo entero dejaba la presencia real (LATAM) como una esquina chiquita.
// De México/EEUU (lat 42) a Patagonia (-57), Pacífico a Atlántico.
const MAPA = { lonMin: -125, lonMax: -25, latMax: 42, latMin: -57 };
const lonX = (lon: number) => ((lon - MAPA.lonMin) / (MAPA.lonMax - MAPA.lonMin)) * 100;
const latY = (lat: number) => ((MAPA.latMax - lat) / (MAPA.latMax - MAPA.latMin)) * 100;

// Ray-casting punto-en-polígono, suficiente para una trama decorativa.
function esTierra(lon: number, lat: number): boolean {
  for (const poly of CONTINENTES) {
    let dentro = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    if (dentro) return true;
  }
  return false;
}

// Dos jerarquías, mismas que el copy: AR/PE laten (mercados en profundidad);
// el resto son países con préstamos o sesiones de borrowers REALES según la
// DB de prod (2026-08-03, por lemonCountry + IP): CO, BR, PY, MX, CL, HN, UY.
const PAISES: { x: number; y: number; vivo?: boolean; label?: string }[] = [
  { x: lonX(-64), y: latY(-34), vivo: true, label: "Argentina" },
  { x: lonX(-77), y: latY(-9), vivo: true, label: "Perú" },
  { x: lonX(-74), y: latY(4), label: "Colombia" },
  { x: lonX(-48), y: latY(-16), label: "Brasil" },
  { x: lonX(-58), y: latY(-23), label: "Paraguay" },
  { x: lonX(-102), y: latY(23), label: "México" },
  { x: lonX(-71), y: latY(-30), label: "Chile" },
  { x: lonX(-87), y: latY(15), label: "Honduras" },
  { x: lonX(-56), y: latY(-33), label: "Uruguay" },
];

// ── EL GLOBO DE SESIONES ────────────────────────────────────────────
// Qué muestra, con precisión — porque acá la precisión ES el argumento:
//  · Puntos FUERTES que laten: los mercados donde prestamos.
//  · Puntos tenues: países desde donde alguien ABRIÓ su línea. No decimos
//    que operamos ahí; decimos que el crédito viajó hasta ahí. Es la tesis
//    de la marca pasando en la vida real, y es verificable.
//
// Datos: 4.716 sesiones de borrowers geolocalizadas por IP contra la DB de
// producción (geoip-lite, el mismo método del panel admin) el 2026-08-10.
//
// Implementación: canvas con proyección ortográfica real (no un mapa plano
// disfrazado). ~900 puntos por frame en canvas es gratis; en DOM sería
// impensable. Gira sólo mientras se ve y a 30fps — misma lección que las
// auras: lo que no está en pantalla no se pinta.
const SESIONES: { cc: string; lon: number; lat: number; n: number; vivo?: boolean }[] = [
  { cc: "AR", lon: -64, lat: -34, n: 3044, vivo: true },
  { cc: "PE", lon: -76, lat: -10, n: 1347, vivo: true },
  { cc: "CO", lon: -74, lat: 4, n: 75, vivo: true },
  { cc: "CL", lon: -71, lat: -30, n: 6, vivo: true },
  { cc: "US", lon: -98, lat: 39, n: 109 },
  { cc: "PY", lon: -58, lat: -23, n: 34 },
  { cc: "MX", lon: -102, lat: 23, n: 33 },
  { cc: "BR", lon: -52, lat: -10, n: 16 },
  { cc: "CA", lon: -106, lat: 56, n: 15 },
  { cc: "ES", lon: -3, lat: 40, n: 7 },
  { cc: "HN", lon: -86, lat: 15, n: 6 },
  { cc: "UY", lon: -56, lat: -33, n: 4 },
  { cc: "PA", lon: -80, lat: 9, n: 4 },
  { cc: "NL", lon: 5, lat: 52, n: 3 },
  { cc: "DE", lon: 10, lat: 51, n: 2 },
  { cc: "IN", lon: 79, lat: 22, n: 2 },
  { cc: "CZ", lon: 15, lat: 50, n: 2 },
  { cc: "JP", lon: 138, lat: 36, n: 2 },
  { cc: "LT", lon: 24, lat: 55, n: 1 },
  { cc: "AT", lon: 14, lat: 47, n: 1 },
  { cc: "GB", lon: -2, lat: 54, n: 1 },
  { cc: "NO", lon: 9, lat: 61, n: 1 },
  { cc: "DK", lon: 10, lat: 56, n: 1 },
];

function GloboSesiones() {
  const t = useT();
  const ref = useRef<HTMLCanvasElement>(null);
  // Estado de rotación en refs: el loop de dibujo y los handlers de arrastre
  // lo comparten sin re-renderizar React en cada frame.
  // Se persigue un DESTINO en vez de mover la cámara directo: el globo llega
  // suavizado (lerp) y el gesto no se siente escalonado. El momento sobrante
  // del arrastre se apaga solo y vuelve al giro automático.
  const lonDest = useRef(-72); // arranca encuadrado en las Américas
  const lon0 = useRef(-72);
  // −10° y no +14°: con la inclinación hacia el norte, el cluster que
  // importa —AR, PE, CO, CL, todos por debajo del ecuador— quedaba escapando
  // por el borde inferior. Inclinado al sur entra de lleno al centro, que es
  // donde el ojo cae al aparecer el globo.
  const tiltDest = useRef((-10 * Math.PI) / 180);
  const tilt = useRef((14 * Math.PI) / 180);
  const momento = useRef(0);
  const arrastrando = useRef(false);
  const ultimoX = useRef(0);
  const ultimoY = useRef(0);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const DPR = Math.min(2, window.devicePixelRatio || 1);
    const CSS = 1040;
    cv.width = CSS * DPR;
    cv.height = CSS * DPR;
    ctx.scale(DPR, DPR);
    const R = CSS * 0.452;
    const cx = CSS / 2;
    const cy = CSS / 2;

    const tierra: [number, number][] = [];
    // Paso 2.3→1.75: ~72% más puntos de tierra. La esfera se veía vacía —los
    // continentes quedaban insinuados en vez de dibujados— y a este tamaño el
    // costo sigue siendo despreciable frente al resto del frame.
    for (let lat = -56; lat <= 74; lat += 1.75) {
      for (let lon = -178; lon <= 178; lon += 1.75) {
        if (esTierra(lon, lat)) tierra.push([lon, lat]);
      }
    }

    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // −0.13: con ocho rutas viajando, el giro a 0.16 sumaba demasiado
    // movimiento y la vista no sabía dónde apoyarse. Más lento, las líneas
    // son el evento y el giro el fondo.
    const AUTO = quieto ? 0 : -0.13;

    // Luz desde arriba-izquierda-frente: la misma dirección que el brillo de
    // la esfera. Cada punto se ilumina según su normal, no según lo cerca que
    // está del centro — eso es lo que lo hace leer como volumen y no como un
    // disco con degradado.
    const LX = -0.46, LY = 0.58, LZ = 0.67;

    // Las rutas: sólo entre mercados VIVOS, y sólo las que tienen sentido
    // geográfico (vecinos por la costa del Pacífico y el corredor atlántico).
    // Ocho rutas y no cuatro: las cuatro originales se apiñaban todas sobre
    // el cono sur y el resto del globo quedaba muerto. Con estas los trazos
    // salen hacia el norte (MX, US), al este (BR) y cruzando el Atlántico
    // (ES), así el movimiento se reparte por toda la esfera y siempre hay
    // algo pasando del lado que estés mirando.
    const RUTAS: [string, string][] = [
      ["AR", "PE"],
      ["PE", "CO"],
      ["AR", "CL"],
      ["CL", "PE"],
      ["CO", "MX"],
      ["AR", "BR"],
      ["MX", "US"],
      ["BR", "ES"],
    ];

    // El vector unitario del punto, YA rotado por la longitud actual: así el
    // slerp se hace en el mismo marco en el que proyecta el globo.
    const vec = (lon: number, lat: number): [number, number, number] => {
      const la = (lat * Math.PI) / 180;
      const lo = ((lon - lon0.current) * Math.PI) / 180;
      return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
    };

    // Interpolación sobre la ESFERA (no en pantalla): es lo que hace que el
    // arco siga la curvatura y no cruce el globo por el medio.
    const slerp = (a: [number, number, number], b: [number, number, number], t: number) => {
      const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
      const om = Math.acos(d);
      if (om < 1e-4) return a;
      const sn = Math.sin(om);
      const k1 = Math.sin((1 - t) * om) / sn;
      const k2 = Math.sin(t * om) / sn;
      return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2] as [number, number, number];
    };

    // Como proy() pero para un vector ya rotado y con altura sobre la esfera.
    const proyAlt = (v: [number, number, number], alt: number) => {
      const T = tilt.current;
      const ny = Math.cos(T) * v[1] - Math.sin(T) * v[2];
      const nz = Math.sin(T) * v[1] + Math.cos(T) * v[2];
      return { x: cx + R * alt * v[0], y: cy - R * alt * ny, z: nz };
    };

    const proy = (lon: number, lat: number) => {
      const T = tilt.current;
      const la = (lat * Math.PI) / 180;
      const lo = ((lon - lon0.current) * Math.PI) / 180;
      const nx = Math.cos(la) * Math.sin(lo);
      const ty = Math.sin(la);
      const tz = Math.cos(la) * Math.cos(lo);
      const ny = Math.cos(T) * ty - Math.sin(T) * tz;
      const nz = Math.sin(T) * ty + Math.cos(T) * tz; // hacia la cámara
      if (nz <= 0.02) return null;
      return {
        x: cx + R * nx,
        y: cy - R * ny,
        z: nz,
        luz: Math.max(0, nx * LX + ny * LY + nz * LZ),
      };
    };

    let raf = 0;
    let ultimo = 0;
    let fase = 0;

    const pintar = (ts: number) => {
      raf = requestAnimationFrame(pintar);
      // 30fps alcanzan para el giro automático, pero arrastrando se sentía
      // LAG puro: la mano va a 60 y el globo respondía a 30. Con interacción
      // activa se pinta a frame completo; quieto, vuelve a ahorrar.
      if (!arrastrando.current && ts - ultimo < 33) return;
      ultimo = ts;

      if (!arrastrando.current) {
        momento.current *= 0.94; // el envión se apaga solo
        lonDest.current += AUTO + momento.current;
        tiltDest.current += ((-10 * Math.PI) / 180 - tiltDest.current) * 0.02;
      }
      // agarrado: el globo sigue al dedo casi 1:1 (0.55) — el 0.16 de goma
      // está bien para el giro automático pero en el drag era media vuelta de
      // retraso. Al soltar vuelve el suavizado.
      const k = arrastrando.current ? 0.55 : 0.16;
      lon0.current += (lonDest.current - lon0.current) * k;
      tilt.current += (tiltDest.current - tilt.current) * k;
      fase += 0.045;

      ctx.clearRect(0, 0, CSS, CSS);

      // OJO con el radio del halo: el lienzo mide CSS y el centro está en
      // CSS/2, así que cualquier cosa que pase de R*1.10 (con R = 0.452·CSS)
      // se recorta contra el borde del canvas y deja un filo RECTO. Es lo que
      // pasaba: se veía un rectángulo azul alrededor del globo.
      const halo = ctx.createRadialGradient(cx, cy, R * 0.88, cx, cy, R * 1.085);
      halo.addColorStop(0, "rgba(24,80,180,0.24)");
      halo.addColorStop(0.5, "rgba(22,95,215,0.10)");
      halo.addColorStop(1, "rgba(20,109,250,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.085, 0, Math.PI * 2);
      ctx.fillStyle = halo;
      ctx.fill();

      const g = ctx.createRadialGradient(cx - R * 0.34, cy - R * 0.38, R * 0.06, cx, cy, R);
      g.addColorStop(0, "#173863");
      g.addColorStop(0.42, "#0D2647");
      g.addColorStop(0.78, "#06182F");
      g.addColorStop(0.93, "rgba(3,11,24,0.94)");
      g.addColorStop(0.985, "rgba(3,11,24,0.40)");
      g.addColorStop(1, "rgba(3,11,24,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      // especular: el reflejo de la fuente de luz sobre la esfera
      const esp = ctx.createRadialGradient(
        cx - R * 0.42, cy - R * 0.46, 0,
        cx - R * 0.42, cy - R * 0.46, R * 0.85
      );
      esp.addColorStop(0, "rgba(180,215,255,0.30)");
      esp.addColorStop(0.5, "rgba(120,170,255,0.07)");
      esp.addColorStop(1, "rgba(120,170,255,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = esp;
      ctx.fill();

      for (const [lon, lat] of tierra) {
        const p = proy(lon, lat);
        if (!p) continue;
        // más contraste: el mínimo sube de 0.05 a 0.14 y el rango a 0.96, así
        // los puntos del borde no desaparecen contra el azul del globo
        const a = 0.14 + p.luz * 0.96;
        const d = p.z > 0.55 ? 1.9 : 1.5;
        ctx.fillStyle = `rgba(216,234,255,${a})`;
        ctx.fillRect(p.x - d / 2, p.y - d / 2, d, d);
      }

      // LAS RUTAS DEL CAPITAL. La analogía no es decorativa: en /stats la
      // rotación de capital es 8.3× — el vault tiene ~$4.7k y originó ~$39.5k,
      // o sea que el MISMO dólar financió un préstamo en Argentina, volvió, y
      // ahora financia uno en Perú. Eso es lo que muestran los pulsos: no
      // "conexiones" genéricas, sino la plata rotando entre mercados.
      //
      // Costo: 4 rutas × 26 muestras = ~104 proyecciones por frame, contra las
      // ~5.000 de los puntos de tierra que ya se dibujan. Es ruido estadístico.
      for (let i = 0; i < RUTAS.length; i++) {
        const [ca, cb] = RUTAS[i];
        const A = SESIONES.find((x) => x.cc === ca);
        const B = SESIONES.find((x) => x.cc === cb);
        if (!A || !B) continue;
        const va = vec(A.lon, A.lat);
        const vb = vec(B.lon, B.lat);
        // el ángulo entre los dos puntos manda cuánto se eleva el arco
        const cosAng = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
        const alturaArco = Math.min(0.09, 0.03 + Math.acos(cosAng) * 0.05);

        // LA LÍNEA SE GENERA HACIA SU DESTINO. Antes eran DOS cosas: un trazo
        // guía fijo y un pulso brillante encima, y se leían como dos objetos
        // separados. Ahora hay una sola línea: la cabeza avanza del origen al
        // destino dibujándola, y después la cola la alcanza y el destino se la
        // traga. El recorrido entero cuenta un viaje, no un adorno que pasa
        // por arriba de un cable.
        //
        // Un solo tono cálido —el intermedio entre los dos que había— en dos
        // grosores: el ancho hace de halo y el fino de núcleo. Mismo color en
        // los dos, así se leen como UNA línea con brillo y no como dos.
        const ciclo = 1.55;
        // 0.115→0.165: el viaje completo baja a ~1.3s. Y con OCHO rutas el
        // unísono dejó de servir —salían las ocho de golpe y después nada—:
        // el desfase las reparte en el tiempo, así siempre hay dos o tres en
        // vuelo y el globo nunca queda quieto.
        const t = (fase * 0.165 + i * 0.19) % ciclo;
        // ENTERIZA: la cola no se mueve hasta que la cabeza LLEGÓ. Antes
        // arrancaba a t=0.62 —con la cabeza a mitad de camino— y la línea se
        // despegaba del origen y quedaba flotando. Ahora se dibuja completa
        // de A a B, y recién tocando destino se deja tragar.
        const cab = Math.max(0, Math.min(1, t / 1.0));
        const col = Math.max(0, Math.min(1, (t - 1.0) / 0.45));

        // EL IMPACTO: cuando la cabeza llega, el destino destella — un anillo
        // que se expande y se apaga mientras la cola termina de entrar. Es un
        // solo arc() por frame durante ~0.4 del ciclo: gratis.
        if (t > 1.0 && t < 1.45) {
          const e = (t - 1.0) / 0.45;
          const qB = proyAlt(vb, 1);
          if (qB.z > 0.02) {
            ctx.beginPath();
            ctx.arc(qB.x, qB.y, 6 + e * 26, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255,201,139,${(1 - e) * 0.75 * qB.z})`;
            ctx.lineWidth = 2.4 * (1 - e * 0.6);
            ctx.stroke();
          }
        }
        if (cab > col) {
          // la profundidad del centro del tramo visible decide su brillo
          const zMedio = Math.max(0, proyAlt(slerp(va, vb, (cab + col) / 2), 1).z);
          for (const capa of [
            { w: 9, op: 0.13 },
            { w: 3.2, op: 0.95 },
          ]) {
            ctx.beginPath();
            let corte = true;
            const N = 30;
            for (let k = 0; k <= N; k++) {
              const u = col + ((cab - col) * k) / N;
              // ALTURA PROPORCIONAL AL LARGO, y mucho menor. Con 0.17 fijo
              // las rutas largas —BR→ES cruza el Atlántico, ~80° de arco— se
              // elevaban tanto que salían del contorno de la esfera y
              // quedaban flotando en el fondo azul; ahí el corte del limbo se
              // ve como si la línea desapareciera por un bug.
              // Ahora la elevación arranca en 0.03 y crece con el ángulo hasta
              // un tope de 0.09: el arco se despega lo justo para leerse como
              // arco, sin salirse nunca del globo.
              const q = proyAlt(slerp(va, vb, u), 1 + alturaArco * Math.sin(u * Math.PI));
              if (q.z <= 0.02) { corte = true; continue; }
              if (corte) { ctx.moveTo(q.x, q.y); corte = false; }
              else ctx.lineTo(q.x, q.y);
            }
            // el trazo se apaga a medida que dobla hacia el fondo: cortar
            // seco en z=0.02 se veía como si la línea se cayera del mundo
            ctx.strokeStyle = `rgba(255,201,139,${capa.op * Math.min(1, 0.25 + zMedio * 2.2)})`;
            ctx.lineWidth = capa.w;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.stroke();
          }
        }
      }

      for (const s of SESIONES) {
        const p = proy(s.lon, s.lat);
        if (!p) continue;
        const r = s.vivo ? 5.2 : 2.8 + Math.min(2, Math.log10(s.n + 1));
        if (s.vivo) {
          const pulso = (Math.sin(fase + s.lon * 0.05) + 1) / 2;
          const gl = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r + 18 + pulso * 12);
          gl.addColorStop(0, `rgba(255,164,74,${0.68 * p.z})`);
          gl.addColorStop(0.45, `rgba(249,116,21,${0.22 * p.z})`);
          gl.addColorStop(1, "rgba(249,116,21,0)");
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 18 + pulso * 12, 0, Math.PI * 2);
          ctx.fillStyle = gl;
          ctx.fill();
        }
        if (s.vivo) {
          const nucleo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          nucleo.addColorStop(0, `rgba(255,246,232,${0.96 * p.z + 0.04})`);
          nucleo.addColorStop(0.42, `rgba(255,186,110,${0.92 * p.z + 0.08})`);
          nucleo.addColorStop(1, `rgba(249,116,21,${0.80 * p.z + 0.10})`);
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle = nucleo;
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,168,86,${0.52 + p.z * 0.44})`;
          ctx.fill();
        }
      }

      // Luz de borde sólo del lado iluminado, y con degradado a lo largo del
      // arco: un contorno de grosor parejo aplana la esfera en un disco. No
      // hay ninguna línea que cierre el círculo — el filo lo termina el
      // desvanecido del relleno.
      const rim = ctx.createLinearGradient(cx - R, cy - R, cx + R * 0.6, cy + R);
      rim.addColorStop(0, "rgba(190,222,255,0.62)");
      rim.addColorStop(0.55, "rgba(160,200,255,0.26)");
      rim.addColorStop(1, "rgba(140,180,240,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, R - 0.6, Math.PI * 0.60, Math.PI * 1.78);
      ctx.strokeStyle = rim;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    };

    // El globo se gatea por visibilidad: gira de forma continua, así que
    // fuera de pantalla no tiene por qué consumir frames.
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        if (!raf) raf = requestAnimationFrame(pintar);
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    io.observe(cv);
    pintar(0);

    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // Arrastre: agarrás el globo y lo girás. Al soltar sigue con inercia y
  // vuelve solo al giro automático.
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    arrastrando.current = true;
    ultimoX.current = e.clientX;
    ultimoY.current = e.clientY;
    momento.current = 0;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!arrastrando.current) return;
    const dx = e.clientX - ultimoX.current;
    const dy = e.clientY - ultimoY.current;
    ultimoX.current = e.clientX;
    ultimoY.current = e.clientY;
    lonDest.current -= dx * 0.30;
    // el momento se promedia con lo anterior: un tirón brusco no salta
    momento.current = momento.current * 0.6 - dx * 0.30 * 0.4;
    // vertical = inclinación, topeada para no dar vuelta el planeta.
    // Signo POSITIVO: arrastrás hacia arriba y el globo se inclina hacia
    // arriba — estaba invertido y se sentía al revés del gesto.
    const t = tiltDest.current + dy * 0.004;
    tiltDest.current = Math.max(-0.5, Math.min(0.85, t));
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    arrastrando.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* el puntero ya se fue */
    }
  };

  return (
    <div className="flex w-full flex-col items-center">
      {/* 880 y no 1040: el globo pesaba de más y empujaba la tarjeta a 1120
          de alto. A este tamaño sigue siendo el protagonista y la tarjeta se
          acorta un montón. */}
      <div className="relative w-full" style={{ maxWidth: 880 }}>
        <canvas
          ref={ref}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
          className="w-full cursor-grab touch-none active:cursor-grabbing"
          style={{ aspectRatio: "1 / 1" }}
          aria-label={t(
            "Globo con los países donde Lendoor presta y desde donde los usuarios abrieron su línea. Arrastralo para girarlo.",
            "Globe showing where Lendoor lends and where users opened their line from. Drag to spin it."
          )}
        />
      </div>

    </div>
  );
}

function MapaAlcance() {
  return (
    <div className="relative w-full max-w-[460px]" style={{ aspectRatio: "1.35/1" }}>
      {/* La trama: las AMÉRICAS en puntos neutros (ventana MAPA). Algunos
          TITILAN en naranja tenue (los destellos del mapa de la referencia) —
          actividad latente, elegidos determinísticamente para no romper el
          resume. */}
      <div className="absolute inset-0">
        {Array.from({ length: 52 * 44 }).map((_, i) => {
          const col = i % 52, row = Math.floor(i / 52);
          const x = 1 + col * 1.92, y = 1 + row * 2.27;
          // celda del lienzo → lon/lat para el test de tierra
          const lon = MAPA.lonMin + (x / 100) * (MAPA.lonMax - MAPA.lonMin);
          const lat = MAPA.latMax - (y / 100) * (MAPA.latMax - MAPA.latMin);
          if (!esTierra(lon, lat)) return null;
          const titila = (col * 7 + row * 13) % 41 === 0;
          return (
            <span
              key={i}
              className="absolute h-[3px] w-[3px] rounded-full"
              style={{
                left: `${x}%`,
                top: `${y}%`,
                backgroundColor: titila ? T.o300 : "rgba(42,23,16,0.32)",
                ...(titila
                  ? { animation: `mapaTitila 3.8s ease-in-out ${((col + row) % 7) * 0.55}s infinite` }
                  : {}),
              }}
            />
          );
        })}
      </div>
      {/* Los países vivos LATEN (halo en loop); los demás con actividad real
          quedan fijos en naranja, más chicos — presencia sin over-claim. */}
      {PAISES.map((p) => (
        <span
          key={p.label}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${p.x}%`, top: `${p.y}%` }}
          title={p.label}
        >
          {p.vivo && (
            <span
              className="absolute left-1/2 top-1/2 h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ backgroundColor: "rgba(249,116,21,0.28)", animation: "mapaPulso 2.6s ease-out infinite" }}
            />
          )}
          <span
            className="relative block rounded-full"
            style={
              p.vivo
                ? { height: 11, width: 11, backgroundColor: ACCENT }
                : { height: 7, width: 7, backgroundColor: T.o300, boxShadow: "0 0 0 3px rgba(249,116,21,0.14)" }
            }
          />
        </span>
      ))}
      <style>{`
        @keyframes mapaTitila { 0%,100% { opacity: 0.35 } 50% { opacity: 1 } }
        @keyframes mapaPulso { 0% { transform: translate(-50%,-50%) scale(0.4); opacity: 0.9 } 100% { transform: translate(-50%,-50%) scale(1.6); opacity: 0 } }
        @media (prefers-reduced-motion: reduce) {
          [style*="mapaTitila"], [style*="mapaPulso"] { animation: none !important }
        }
      `}</style>
    </div>
  );
}

// ── SECCIÓN ─────────────────────────────────────────────────────────
// Antes eran tarjetas sticky que se apilaban. Se sacó el apilado: la
// referencia no lo usa y con seis paneles la progresión se leía como lista.
// Ahora son secciones planas separadas por la rejilla, como el resto de la
// página — más sobrio y más "startup de infra".
// Lo que SÍ se conserva es el aura: cada sección respira con su propia luz.
function Panel({
  i,
  id,
  children,
  oscuro = false,
}: {
  i: number;
  id?: string;
  children: ReactNode;
  oscuro?: boolean;
}) {
  return (
    // Cada sección es un lienzo, igual que el hero y que "lo que ponemos".
    // Sueltas sobre el fondo se leían como texto cayendo por la página; el
    // lienzo les da el mismo piso y la página pasa a ser una pila de bloques.
    //
    // [overflow:clip] y NO overflow-hidden en la sección: hidden crea un
    // scroll container y eso mata el position:sticky del visual de
    // ComoFunciona (el sticky pasa a referenciar una caja que nunca
    // scrollea). El lienzo de adentro sí recorta, pero como no scrollea, el
    // sticky lo atraviesa sin problema.
    <section id={id} className="relative [overflow:clip] scroll-mt-24 px-4 py-5 md:px-6">
      <MarcoPlano oscuro={oscuro} className={`${SEC_X} ${SEC_Y}`}>{children}</MarcoPlano>
    </section>
  );
}

function PanelHead({
  kicker,
  headA,
  accent,
  headB,
  lede,
  serif = false,
  oscuro = false,
}: {
  kicker: string;
  headA: string;
  accent: string;
  headB: string;
  lede: string;
  /** El acento serif es UN evento, no un adorno de cada título (§3).
   *  Solo lo prende el panel de la tesis (la escalera). */
  serif?: boolean;
  oscuro?: boolean;
}) {
  return (
    <>
      <Kicker oscuro={oscuro}>{kicker}</Kicker>
      <h2
        className="mt-4 max-w-[22ch] font-bold tracking-tight"
        style={{ color: oscuro ? "#fff" : INK, fontSize: "clamp(1.95rem, 3.4vw, 3rem)", lineHeight: 1.05 }}
      >
        {headA}
        {serif ? <Accent>{accent}</Accent> : accent}
        {headB}
      </h2>
      <p
        className="mt-4 max-w-[44ch] text-[17px] leading-relaxed"
        style={{ color: oscuro ? "rgba(255,255,255,0.72)" : INK_65 }}
      >
        {lede}
      </p>
    </>
  );
}

// El mock del flujo de pedido — el equivalente de la tarjeta de input de la
// referencia (su "Plan, search…"): un pedazo de producto usable, no una
// ilustración. Números consistentes con el pricing real (Prime+ 14%/mes,
// 14 días → ~6.5% del período).
function PedidoMock() {
  const t = useT();
  return (
    <div className="relative w-full max-w-[420px]">
      {/* El badge flotante de la referencia (su "✓ Connected" azul candy
          colgando del borde de la tarjeta), con nuestra semántica: la línea
          ya está aprobada cuando el usuario llega a esta pantalla. */}
      <span
        className="absolute -top-4 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-white"
        style={{
          background: "linear-gradient(180deg, #fb8a2e 0%, #f97415 52%, #ee6a0d 100%)",
          boxShadow: "0 5px 14px rgba(249,116,21,0.30), inset 0 1px 0 rgba(255,255,255,0.30)",
        }}
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="7" fill="rgba(255,255,255,0.25)" />
          <path d="M5 8.2l2 2 4-4.4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t("Línea aprobada", "Line approved")}
      </span>
      <div
        className="w-full rounded-3xl bg-white p-7"
        style={{ border: `1px solid ${INK_10}`, boxShadow: SH_LIFT }}
      >
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: META }}>
        {t("Pedir préstamo", "Request loan")}
      </p>
      <p
        className="mt-3 font-mono text-[44px] font-bold leading-none tracking-tight [font-variant-numeric:tabular-nums]"
        style={{ color: INK }}
      >
        $30
      </p>
      <div className="mt-5 flex gap-2">
        {[t("7 días", "7 days"), t("14 días", "14 days"), t("21 días", "21 days")].map((plazo, i) => (
          <span
            key={plazo}
            className="rounded-full px-4 py-2 text-[13px] font-semibold"
            style={
              i === 1
                ? { backgroundColor: ACCENT, color: "#fff" }
                : { border: `1px solid ${INK_10}`, color: INK_65 }
            }
          >
            {plazo}
          </span>
        ))}
      </div>
      <p className="mt-5 text-[14px]" style={{ color: INK_65 }}>
        {t("Devolvés ", "You repay ")}<b style={{ color: INK }}>$31.96</b>{t(" en un solo pago.", " in a single payment.")}
      </p>
      <div
        className="mt-5 flex h-12 items-center justify-center rounded-full text-[15px] font-semibold text-white"
        style={{
          background: "linear-gradient(180deg, #fb8a2e 0%, #f97415 52%, #ee6a0d 100%)",
          boxShadow: "0 5px 16px rgba(249,116,21,0.25), inset 0 1px 0 rgba(255,255,255,0.30)",
        }}
        aria-hidden
      >
        {t("Confirmar", "Confirm")}
      </div>
      <p className="mt-4 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: META }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#16a34a" }} />
        {t("USDC en la wallet en segundos", "USDC in the wallet in seconds")}
      </p>
      </div>
    </div>
  );
}

// ── FLUJO ANIMADO (Cómo funciona) ───────────────────────────────────
// Como la referencia: el visual sticky NO es una foto — progresa con los
// pasos. Paso 1: la terminal tipea la conexión de la wallet. Paso 2: un
// popup aparece ENCIMA con la línea ya lista (score + límite al instante).
// Paso 3: la pantalla final (pedir / posición). Todo gateado por `paso`,
// que sale de un IntersectionObserver sobre la banda media del viewport.

function LineaTerm({ on, delay, children }: { on: boolean; delay: number; children: ReactNode }) {
  return (
    <div
      style={{
        opacity: on ? 1 : 0,
        transform: on ? "none" : "translateY(5px)",
        transition: `opacity 0.45s ${EASE} ${delay}ms, transform 0.45s ${EASE} ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

function TerminalFlujo({ side, paso }: { side: Side; paso: number }) {
  const t = useT();
  const fintech = side === "fintech";
  const dim = { color: TERM_DIM };
  const arg = { color: TERM_ARG };
  // Grupo A tipea al entrar la sección; grupo B recién cuando el paso 2
  // (evaluamos / el vault presta) cruza el centro de la pantalla.
  const a = true;
  const b = paso >= 1;
  return (
    <div
      className="w-full overflow-hidden"
      style={{ borderRadius: 16, backgroundColor: TERM_BG, border: `1px solid rgba(255,247,238,0.10)` }}
    >
      <div className="flex gap-2 px-4 py-3" style={{ borderBottom: `1px solid rgba(255,247,238,0.08)` }}>
        {[0, 1, 2].map((i) => (
          <i key={i} className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "rgba(255,247,238,0.16)" }} />
        ))}
      </div>
      <div className="px-5 py-5 font-mono text-[12.5px]" style={{ lineHeight: 1.9, color: TERM_VAL }}>
        {fintech ? (
          <>
            <LineaTerm on={a} delay={100}>
              <span style={dim}>$</span> lendoor connect <span style={arg}>--wallet 0x7f…9a4</span>
            </LineaTerm>
            <LineaTerm on={a} delay={420}><span style={dim}>→</span> {t("wallet vinculada ✓", "wallet linked ✓")}</LineaTerm>
            <LineaTerm on={a} delay={740}><span style={dim}>→</span> {t("leyendo huella on-chain…", "reading on-chain footprint…")}</LineaTerm>
            <LineaTerm on={b} delay={100}>
              <span style={dim}>→</span> score <span style={arg}>457</span> · {t("límite", "limit")} <span style={arg}>$30</span>
            </LineaTerm>
            <LineaTerm on={b} delay={420}>
              <span style={arg}>✓</span> {t("línea abierta — lista para usar", "line open — ready to use")}
            </LineaTerm>
          </>
        ) : (
          <>
            <LineaTerm on={a} delay={100}>
              <span style={dim}>$</span> lendoor vault deposit <span style={arg}>--usdc 1000</span>
            </LineaTerm>
            <LineaTerm on={a} delay={420}><span style={dim}>→</span> {t("wallet conectada ✓", "wallet connected ✓")}</LineaTerm>
            <LineaTerm on={a} delay={740}><span style={dim}>→</span> {t("depósito confirmado…", "deposit confirmed…")}</LineaTerm>
            <LineaTerm on={b} delay={100}>
              <span style={dim}>→</span> {t("posición on-chain a tu nombre", "position on-chain under your name")}
            </LineaTerm>
            <LineaTerm on={b} delay={420}>
              <span style={arg}>✓</span> {t("el vault ya está prestando", "the vault is already lending")}
            </LineaTerm>
          </>
        )}
      </div>
    </div>
  );
}

// El popup de la referencia ("Your AI Agent is Ready" con su glow azul),
// en nuestra semántica y nuestro naranja: conectaste, y la línea YA está.
function PopupLinea({ side, on }: { side: Side; on: boolean }) {
  const t = useT();
  const fintech = side === "fintech";
  return (
    <div
      className="w-full rounded-3xl bg-white px-7 py-8 text-center"
      style={{
        border: `1px solid ${INK_10}`,
        boxShadow: SH_LIFT,
        opacity: on ? 1 : 0,
        transform: on ? "none" : "translateY(22px) scale(0.96)",
        transition: `opacity 0.55s ${EASE}, transform 0.55s ${EASE}`,
        background: "linear-gradient(180deg, #ffffff 0%, #fff7ef 100%)",
      }}
    >
      <span
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-full"
        style={{ background: "linear-gradient(180deg, #fb8a2e 0%, #f97415 52%, #ee6a0d 100%)", boxShadow: "0 5px 14px rgba(249,116,21,0.30)" }}
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden>
          <path d="M4 8.4l2.6 2.6L12 5.6" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <p className="mt-4 text-[21px] font-bold tracking-tight" style={{ color: INK }}>
        {fintech ? t("Tu línea está lista.", "Your line is ready.") : t("El vault ya está prestando.", "The vault is already lending.")}
      </p>
      <p className="mx-auto mt-2 max-w-[30ch] text-[13.5px] leading-relaxed" style={{ color: INK_65 }}>
        {fintech
          ? t("Score y límite al instante, apenas conecta la wallet. Sin formularios, sin espera.", "Score and limit the moment the wallet connects. No forms, no waiting.")
          : t("Yield real: sale del interés que la gente efectivamente paga, no de emisión de tokens.", "Real yield: it comes from interest people actually pay, not token emissions.")}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        {(fintech
          ? [[t("Score", "Score"), "457"], [t("Límite", "Limit"), "$30"]]
          : [[t("Préstamos fondeados", "Loans funded"), t("4.546", "4,546")], [t("Repagados a tiempo", "Repaid on time"), t("2.754", "2,754")]]
        ).map(([k, v]) => (
          <div key={k} className="rounded-2xl px-4 py-3" style={{ backgroundColor: BLUE_SOFT }}>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: META }}>{k}</p>
            <p className="mt-1 font-mono text-[20px] font-bold [font-variant-numeric:tabular-nums]" style={{ color: INK }}>{v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// Paso 3 del lado farm: tu posición cobrando el interés de los repagos.
function PosicionMock() {
  const t = useT();
  return (
    <div
      className="w-full rounded-3xl bg-white p-7"
      style={{ border: `1px solid ${INK_10}`, boxShadow: SH_LIFT }}
    >
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: META }}>
        {t("Tu posición", "Your position")}
      </p>
      <p className="mt-3 font-mono text-[44px] font-bold leading-none tracking-tight [font-variant-numeric:tabular-nums]" style={{ color: INK }}>
        $1,011<span style={{ color: INK_45 }}>.20</span>
      </p>
      <p className="mt-3 text-[14px]" style={{ color: INK_65 }}>
        <b style={{ color: "#16a34a" }}>+$11.20</b> {t("de interés cobrado en 30 días.", "in interest collected over 30 days.")}
      </p>
      <div className="mt-5 space-y-2">
        {[
          [t("Depositaste", "You deposited"), "$1,000.00"],
          [t("Interés de repagos", "Repayment interest"), "+$11.20"],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between rounded-2xl px-4 py-3" style={{ backgroundColor: BLUE_SOFT }}>
            <span className="text-[13px]" style={{ color: INK_65 }}>{k}</span>
            <span className="font-mono text-[14px] font-bold [font-variant-numeric:tabular-nums]" style={{ color: INK }}>{v}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: META }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#16a34a" }} />
        {t("Cada repago entra con su interés", "Every repayment arrives with its interest")}
      </p>
    </div>
  );
}

function ComoFunciona({ side }: { side: Side }) {
  const c = useCopy(side);
  const t = useT();
  const [paso, setPaso] = useState(-1);
  const [prog, setProg] = useState(0);
  // hasta dónde llega el riel: el centro del ÚLTIMO medallón. Antes iba de
  // punta a punta del contenedor y seguía de largo bajo el paso 3, como si
  // faltara un cuarto paso que nunca llega.
  const [finRiel, setFinRiel] = useState(0);
  // dónde EMPIEZA: el centro del primer medallón. Arrancando en el tope del
  // contenedor, el naranja aparecía por encima del primer ícono y se veía
  // salir de la nada — tiene que EMANAR del hito, no pasarle por detrás.
  const [iniRiel, setIniRiel] = useState(0);
  const lineaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setPaso(-1);
    const root = document.getElementById("root");
    const cont = lineaRef.current;
    if (!root || !cont) return;
    // Un solo cálculo por frame alimenta las dos cosas: el paso activo (el
    // último medallón que cruzó el centro de la pantalla) y el llenado de la
    // línea (fracción del recorrido ya cruzada). Por posición y no por IO:
    // un salto grande de scroll no se puede saltear ningún estado.
    let raf = 0;
    const calc = () => {
      raf = 0;
      const centro = window.innerHeight * 0.55;
      const r = cont.getBoundingClientRect();
      const hitos = cont.querySelectorAll("[data-hito]");
      const primero = hitos[0] as HTMLElement | undefined;
      const ultimo = hitos[hitos.length - 1] as HTMLElement | undefined;
      const ini = primero
        ? primero.getBoundingClientRect().top - r.top + primero.offsetHeight / 2
        : 0;
      const fin = ultimo
        ? ultimo.getBoundingClientRect().top - r.top + ultimo.offsetHeight / 2
        : r.height;
      setIniRiel(ini);
      setFinRiel(fin);
      // el progreso se mide contra el riel real, no contra el contenedor:
      // así el naranja llega justo al último medallón, ni antes ni después
      setProg(Math.max(0, Math.min(1, (centro - r.top - ini) / Math.max(1, fin - ini))));
      let idx = -1;
      hitos.forEach((el, i) => {
        if (el.getBoundingClientRect().top < centro) idx = i;
      });
      setPaso(idx);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(calc); };
    root.addEventListener("scroll", onScroll, { passive: true });
    calc();
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [side]);

  // los tres glifos de los medallones: conectar → evaluar → despegar
  const GLIFOS = [
    <path key="g0" d="M8 12h8M8 12a3.5 3.5 0 1 1 0-7h2M16 12a3.5 3.5 0 1 0 0 7h-2" stroke="#fff" strokeWidth="2" strokeLinecap="round" transform="translate(0 2.5)" />,
    <g key="g1">
      <path d="M5 15a7 7 0 0 1 14 0" stroke="#fff" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M12 15l3.4-3.4" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="15" r="1.6" fill="#fff" />
    </g>,
    <g key="g2">
      <path d="M12 4c3 2 4 6 3 10l-3 3-3-3C8 10 9 6 12 4z" stroke="#fff" strokeWidth="1.9" strokeLinejoin="round" fill="none" />
      <circle cx="12" cy="10" r="1.4" fill="#fff" />
      <path d="M9.5 15.5 8 19M14.5 15.5 16 19" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" />
    </g>,
  ];

  return (
    // NAVY: la tercera voz. No suma un matiz nuevo —es el mismo #0B2049 de la
    // tarjeta de mora— pero cambia el VALOR, que es lo que faltaba: la página
    // venía alternando cálido/frío en superficies siempre claras. Acá los
    // medallones naranjas y las tarjetas blancas del recorrido explotan.
    <Panel i={1} id="como" oscuro>
      <PanelHead
        oscuro
        kicker="Cómo funciona"
        headA={c.p2headA}
        accent={c.p2accent}
        headB={c.p2headB}
        lede={t("Tres pasos. El orden importa: cada uno depende del anterior.", "Three steps. Order matters: each one depends on the last.")}
      />
      {/* Línea de tiempo (referencia how-it-works-6): la línea al centro con
          el progreso llenándose al scrollear, medallones que se encienden al
          cruzar el centro de pantalla, y las tarjetas alternando de lado. En
          mobile la línea va a la izquierda y las tarjetas a una columna. */}
      <div ref={lineaRef} className="relative mx-auto mt-16 max-w-[980px]">
        {/* el riel y su llenado */}
        {/* left por CLASE y no inline: un style={{left}} pisa al md:left-1/2
            y el riel quedaba clavado a la izquierda también en desktop */}
        <div
          className="absolute left-[21px] w-[2px] rounded-full md:left-1/2 md:-translate-x-1/2"
          style={{ top: iniRiel, height: Math.max(0, finRiel - iniRiel), backgroundColor: "rgba(255,255,255,0.16)" }}
          aria-hidden
        />
        <div
          className="absolute left-[21px] w-[2px] rounded-full md:left-1/2 md:-translate-x-1/2"
          style={{
            top: iniRiel,
            height: prog * Math.max(0, finRiel - iniRiel),
            backgroundColor: ACCENT,
            // SIN transición: los 220ms que tenía eran exactamente el retraso
            // que se sentía al scrollear. Ahora el relleno sigue al dedo 1:1.
          }}
          aria-hidden
        />

        {c.steps.map(([h, pTxt], i) => {
          const on = paso >= i;
          const izquierda = i % 2 === 0;
          return (
            <div
              key={h}
              className={`relative grid gap-0 py-10 md:grid-cols-2 md:py-16 ${i === 0 ? "md:pt-4" : ""} ${
                i === c.steps.length - 1 ? "pb-0 md:pb-0" : ""
              }`}
            >
              {/* el medallón, sobre la línea, alineado al tope de la tarjeta */}
              <div
                data-hito
                // arriba de la tarjeta, no a la par: el medallón MARCA el hito y la
                // tarjeta lo explica debajo — alineados al mismo tope se leían
                // como dos cosas sueltas a la misma altura
                className={`absolute left-0 top-2 z-10 flex items-center justify-center rounded-full md:left-1/2 md:top-4 md:-translate-x-1/2 ${
                  i === c.steps.length - 1 ? "h-[52px] w-[52px]" : "h-11 w-11"
                }`}
                style={{
                  backgroundColor: on ? ACCENT : "rgba(255,255,255,0.22)",
                  boxShadow: on ? "0 0 0 7px rgba(249,116,21,0.20)" : "0 0 0 7px rgba(255,255,255,0.07)",
                  transition: `background-color 420ms ${EASE}, box-shadow 420ms ${EASE}`,
                }}
              >
                {/* PALPITACIÓN al encenderse: un anillo que sale del
                    medallón y se desvanece. El key lo remonta, así corre una
                    sola vez por activación y no queda latiendo de fondo. */}
                {on && (
                  <span
                    key={`ping${i}`}
                    className="hitoPing pointer-events-none absolute inset-0 rounded-full"
                    style={{ backgroundColor: ACCENT }}
                    aria-hidden
                  />
                )}
                {/* EL ÚLTIMO: dos anillos desfasados que siguen saliendo, más
                    un halo fijo. El recorrido no termina con un punto igual a
                    los otros — termina con algo que sigue latiendo. */}
                {on && i === c.steps.length - 1 && (
                  <>
                    <span
                      className="hitoLatido pointer-events-none absolute inset-0 rounded-full"
                      style={{ boxShadow: `0 0 0 2.5px ${ACCENT}` }}
                      aria-hidden
                    />
                    <span
                      className="hitoLatido pointer-events-none absolute inset-0 rounded-full"
                      style={{ boxShadow: `0 0 0 2px ${ACCENT}`, animationDelay: "1400ms" }}
                      aria-hidden
                    />
                  </>
                )}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="relative" aria-hidden>{GLIFOS[i]}</svg>
              </div>

              {/* la tarjeta, alternando de lado (en mobile siempre a la derecha del riel) */}
              <div
                className={`ml-16 md:ml-0 ${izquierda ? "md:col-start-1 md:mr-14" : "md:col-start-2 md:ml-14"}`}
              >
                <div
                  className="rounded-[18px] bg-white px-7 py-7 md:px-6"
                  style={{
                    boxShadow: "0 16px 38px -24px rgba(11,32,73,0.30)",
                    // sobre navy, bajar la opacidad de una tarjeta blanca la
                    // vuelve gris azulado y se ensucia: 0.78 la deja legible
                    opacity: on ? 1 : 0.78,
                    transform: on ? "none" : "translateY(10px)",
                    transition: `opacity 480ms ${EASE}, transform 480ms ${EASE}`,
                  }}
                >
                  <p className="font-mono text-[11.5px] font-bold tracking-[0.1em]" style={{ color: META }}>
                    {t("PASO", "STEP")} 0{i + 1}
                  </p>
                  <h3
                    className="mt-2.5 font-bold tracking-tight"
                    style={{ color: INK, fontSize: "clamp(1.3rem, 1.8vw, 1.65rem)", lineHeight: 1.15 }}
                  >
                    {h}
                  </h3>
                  <p className="mt-3 text-[15px] leading-relaxed" style={{ color: INK_65 }}>
                    {pTxt}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        /* la palpitación al encenderse: UNA vez, y bien visible */
        .hitoPing {
          animation: hitoPing 1100ms cubic-bezier(0.16, 0.7, 0.3, 1) 1 forwards;
        }
        @keyframes hitoPing {
          0%   { transform: scale(1);   opacity: 0.62 }
          100% { transform: scale(2.7); opacity: 0 }
        }
        /* lento y tenue: marca el final del recorrido, no pide atención */
        /* el latido del final: el anillo SALE y se va, no respira en el lugar
           — así el último hito se lee como un faro y no como un botón */
        .hitoLatido {
          animation: hitoLatido 2800ms cubic-bezier(0.16, 0.7, 0.3, 1) infinite;
        }
        @keyframes hitoLatido {
          0%   { transform: scale(1);    opacity: 0.55 }
          70%  { transform: scale(2.35); opacity: 0 }
          100% { transform: scale(2.35); opacity: 0 }
        }
        @media (prefers-reduced-motion: reduce) {
          .hitoPing, .hitoLatido { animation: none; opacity: 0 }
        }
      `}</style>

      {/* EL CIERRE DEL RECORRIDO. Era un bloque centrado de 46ch que se leía
          como "otro texto más" después de tres tarjetas: mismo ancho, misma
          alineación, ningún cambio de ritmo. Ahora es una tarjeta con
          superficie propia —blanca sobre el navy, como los pasos, pero a todo
          el ancho— y a dos columnas: el argumento a la izquierda, la acción a
          la derecha. El salto de layout es lo que avisa que el recorrido
          terminó y esto es otra cosa.
          También suma lo que faltaba: qué pasa DESPUÉS de escribir. Un CTO no
          manda un mail sin saber qué le van a contestar. */}
      <div
        id="acceso"
        className="mt-20 grid scroll-mt-24 items-center gap-8 rounded-[18px] bg-white px-8 py-9 md:grid-cols-[1.25fr_1fr] md:gap-12 md:px-12 md:py-11"
        style={{ boxShadow: "0 22px 50px -28px rgba(3,12,32,0.55)" }}
      >
        <div>
          <Kicker>{t("Acceso", "Access")}</Kicker>
          <h3
            className="mt-4 max-w-[18ch] font-bold tracking-tight"
            style={{ color: INK_TIT, fontSize: "clamp(1.7rem, 2.8vw, 2.45rem)", lineHeight: 1.07 }}
          >
            {t("Abrí la puerta en tu app.", "Open the door in your app.")}
          </h3>
          <p className="mt-4 max-w-[46ch] text-[16px] leading-relaxed" style={{ color: INK_65 }}>
            {t(
              "Contanos qué construís y te decimos en la primera llamada si tiene sentido.",
              "Tell us what you are building and we will tell you on the first call whether it makes sense."
            )}
          </p>

          {/* RESPALDO, y va acá y no en el loop de integraciones a propósito.
              Ese loop dice "con qué está enchufado el producto" — Celo, USDC,
              MetaMask. Pygma no está integrada con nada: nos respaldó. Metida
              ahí adentro se diluye justo en lo único que la hace valer, y de
              paso vuelve mentira la etiqueta del loop.
              Al lado del CTA porque es donde alguien que está por escribirte
              se pregunta quién más te creyó. */}
          <div className="mt-8 flex items-center gap-3.5">
            <span
              className="shrink-0 font-mono text-[10.5px] font-bold uppercase tracking-[0.16em]"
              style={{ color: META }}
            >
              {t("Con el respaldo de", "Backed by")}
            </span>
            <img
              src="/logos/pygma.png"
              alt="Pygma"
              draggable={false}
              className="h-[19px] w-auto opacity-70 transition-opacity duration-300 hover:opacity-100"
            />
          </div>
        </div>

        <div className="md:justify-self-end">
          {/* Las tres cosas que pasan después de escribir: quita la fricción
              de "¿y ahora qué?", que es la que frena el mail. */}
          <ul className="grid list-none gap-3.5 p-0" style={{ margin: 0 }}>
            {[
              [t("Respondemos en 24 h hábiles.", "We reply within 24 business hours.")],
              [t("Primera llamada de 30 minutos.", "A first 30-minute call.")],
              [t("Sandbox con datos de prueba.", "Sandbox with test data.")],
            ].map(([txt]) => (
              <li key={txt} className="flex items-start gap-2.5 text-[15px]" style={{ color: INK }}>
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" className="mt-[3px] shrink-0" aria-hidden>
                  <circle cx="10" cy="10" r="9" stroke={ACCENT} strokeWidth="1.5" />
                  <path d="M6 10.2l2.6 2.6L14 7.4" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>{txt}</span>
              </li>
            ))}
          </ul>
          <div className="mt-7">
            <Cta href="mailto:hola@lendoor.xyz?subject=Solicitar%20acceso%20a%20Lendoor" size="lg">
              {t("Solicitar acceso", "Request access")}
            </Cta>
          </div>
        </div>
      </div>
    </Panel>
  );
}




// ── FAQ ─────────────────────────────────────────────────────────────
const FAQ_ES: [string, string][] = [
  [
    "¿Cómo se construye el score?",
    "Leemos la huella que la persona ya generó: actividad on-chain de su wallet, volumen de stablecoins, antigüedad, y prueba de ingresos de las apps soportadas.",
  ],
  [
    "¿Qué tengo que construir de mi lado?",
    "Una llamada a la API para abrir la línea y una pantalla para mostrarla. Podés consumir los endpoints y diseñarla vos. No hay custodia, nodos ni contratos que mantener.",
  ],
  [
    // Un CTO que evalúa riesgo de smart contract pregunta esto primero, y la
    // respuesta HONESTA cambia según la cadena: en Celo el vault es Euler v2
    // (EVK), de un tercero auditado, y lo nuestro es el módulo de crédito que
    // va encima; en Stellar el vault y el loan manager son contratos Soroban
    // propios. Decir "Euler" en la landing de Stellar sería mentir sobre lo
    // único que ese CTO vino a verificar.
    "¿Sobre qué contratos corre el vault?",
    CADENA.red === "Celo"
      ? "Sobre Euler v2, un protocolo auditado y con años en producción. Lo nuestro es el módulo de crédito que va encima."
      : "Sobre contratos Soroban propios, escritos en Rust: un vault de liquidez y un loan manager con el límite y el score de cada wallet.",
  ],
  [
    "¿En qué países operan?",
    "Hoy operamos en cuatro países de LATAM.",
  ],
];

const FAQ_PT: [string, string][] = [
  [
    "Como o score é construído?",
    "Lemos a pegada que a pessoa já gerou: atividade on-chain da wallet, volume de stablecoins, idade da conta e — quando ela começa — o próprio histórico de pagamentos conosco. O primeiro empréstimo é pequeno de propósito; o limite cresce pagando.",
  ],
  [
    "O que eu preciso construir do meu lado?",
    "Uma chamada à API para abrir a linha e uma tela para mostrá-la. Você consome os endpoints e desenha a sua. Não há custódia, nós de rede nem contratos para manter.",
  ],
  [
    "Sobre quais contratos roda o vault?",
    CADENA.red === "Celo"
      ? "Sobre a Euler v2, um protocolo auditado e com anos em produção. O nosso é o módulo de crédito que vai por cima."
      : "Sobre contratos Soroban próprios, escritos em Rust: um vault de liquidez e um loan manager com o limite e o score de cada wallet.",
  ],
  [
    "Em quais países vocês operam?",
    "Hoje operamos em quatro países da LATAM.",
  ],
];

const FAQ_EN: [string, string][] = [
  [
    "How is the score built?",
    "We read the footprint the person already generated: their wallet's on-chain activity, stablecoin volume, account age, and income proof from supported apps.",
  ],
  [
    "What do I have to build on my side?",
    "One API call to open the line and one screen to show it. Use our SDK and get the screen ready-made, or consume the endpoints and design it yourself. No custody, no nodes, no contracts to maintain.",
  ],
  [
    "Which contracts does the vault run on?",
    CADENA.red === "Celo"
      ? "On Euler v2, an audited protocol with years in production. Ours is the credit module on top."
      : "On our own Soroban contracts, written in Rust: a liquidity vault and a loan manager holding each wallet's limit and score.",
  ],
  [
    "Which countries do you operate in?",
    "We operate in four LATAM countries today.",
  ],
];


// ── PREGUNTAS ───────────────────────────────────────────────────────
// Antes iba centrado con max-w y arrancaba 250px más adentro que todo lo
// demás: era el desalineo más visible de la página. Ahora usa la MISMA
// grilla 1:2 que las filas, así el título queda en la columna de la
// izquierda y las preguntas en la de la derecha, alineadas con el resto.
// Acordeón controlado en vez de <details>: el nativo abre de un salto, sin
// transición. El truco grid-rows 0fr→1fr anima "height auto" en todos los
// browsers sin medir nada, y el + rota a × con el mismo easing.
function FilaFaq({ q, a, borde, abiertaInicial }: { q: string; a: string; borde: boolean; abiertaInicial: boolean }) {
  const [abierta, setAbierta] = useState(abiertaInicial);
  return (
    // Estilo Aave: nada de tarjetas — la fila es transparente sobre el
    // lienzo y una hairline separa pregunta de pregunta. Es la excepción
    // consciente a "cero líneas": acá la línea es la fila (como en una
    // tabla), no decoración. El + va en acento, a la derecha.
    <div style={{ borderTop: borde ? "1px solid rgba(42,23,16,0.10)" : "none" }}>
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className="flex w-full cursor-pointer items-center gap-4 py-6 text-left text-[18px] font-semibold"
        style={{ color: INK }}
      >
        {q}
        <span
          className="ml-auto text-[22px] font-normal leading-none"
          style={{ color: ACCENT, transform: abierta ? "rotate(45deg)" : "none", transition: `transform 0.35s ${EASE}` }}
          aria-hidden
        >
          +
        </span>
      </button>
      <div
        className="grid"
        style={{ gridTemplateRows: abierta ? "1fr" : "0fr", transition: `grid-template-rows 0.4s ${EASE}` }}
      >
        <div className="overflow-hidden">
          <p
            className="max-w-[62ch] pb-6 text-[15px] leading-relaxed"
            style={{
              color: INK_65,
              opacity: abierta ? 1 : 0,
              transform: abierta ? "none" : "translateY(-6px)",
              transition: `opacity 0.35s ${EASE} ${abierta ? "0.08s" : "0s"}, transform 0.35s ${EASE} ${abierta ? "0.08s" : "0s"}`,
            }}
          >
            {a}
          </p>
        </div>
      </div>
    </div>
  );
}

function Preguntas() {
  const { lang } = useLang();
  const FAQ = lang === "es" ? FAQ_ES : lang === "pt" ? FAQ_PT : FAQ_EN;
  return (
    <div id="faq" className="relative scroll-mt-24">
      <div className="relative grid md:grid-cols-[1fr_2fr]">

        <div className={`${SEC_X} ${SEC_Y_SM}`}>
          <Kicker>{lang === "es" ? "Preguntas" : lang === "pt" ? "Perguntas" : "Questions"}</Kicker>
          <h2
            className="mt-4 max-w-[14ch] font-bold tracking-tight"
            style={{ color: INK_TIT, fontSize: "clamp(1.95rem, 3.4vw, 3rem)", lineHeight: 1.05 }}
          >
            {lang === "es" ? (
              <>Preguntas <Accent>frecuentes</Accent>.</>
            ) : lang === "pt" ? (
              <>Perguntas <Accent>frequentes</Accent>.</>
            ) : (
              <>Frequently asked <Accent>questions</Accent>.</>
            )}
          </h2>
        </div>

        <div className={`${SEC_X} ${SEC_Y_SM}`}>
          {FAQ.map(([q, a], i) => (
            <FilaFaq key={q} q={q} a={a} borde={i > 0} abiertaInicial={i === 0} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── TIRAS DE LOGOS ──────────────────────────────────────────────────
// Dos tiras, con trabajos distintos — y por eso NO se mezclan en una sola:
//
//  · TiraStack va debajo del hero y contesta "¿sobre qué corre esto?".
//    Es credibilidad: el vault no es un contrato nuestro, es Euler v2, y
//    liquida en Celo con USDC.
//  · TiraIngresos va bajo el diagrama y contesta "¿de dónde sacan la data?".
//    Ahí los logos no decoran: son información concreta.
//
// Acá vivía una ÓRBITA (los mismos cuatro logos girando alrededor de un
// picaporte) que nunca se montó y duplicaba los nodos de FlujoInterior. Una
// tira quieta dice lo mismo sin pedir una animación ni una sección entera.
//
// Sin marquee a propósito: el loop infinito existe para insinuar "hay
// muchísimos más", y con cuatro logos girando en el vacío el efecto se
// invierte — se lee como que estamos estirando lo poco que hay.

/** Una celda: ícono + nombre en lockup horizontal.
 *
 * El lockup no es decoración — resuelve dos problemas a la vez. Los marks
 * mezclan aspectos (Celo y USDC son cuadrados, Lemon es redondo, Euler es un
 * wordmark que no tenemos): alineados solos, un logo ancho pesa el triple que
 * una moneda y la fila queda desbalanceada. Con el nombre al lado, todas las
 * celdas miden parecido y la que no tiene ícono (Euler) deja de ser la rara.
 * Y de paso el logo chico se vuelve legible: a 26px un ícono gris no se
 * reconoce, el texto lo dice.
 */
function CeldaLogo({
  src,
  alt,
  nota,
  round = false,
  oculto = false,
}: {
  src?: string;
  alt: string;
  nota: string;
  round?: boolean;
  /** la copia duplicada de la pista: visible, pero invisible al lector de pantalla */
  oculto?: boolean;
}) {
  return (
    <div
      className="group flex shrink-0 items-center gap-2.5"
      title={nota}
      aria-hidden={oculto || undefined}
    >
      {/* El gesto: apagado en reposo, color pleno al pasar el mouse.
          Grayscale PARCIAL (0.7) y no total: a gris pleno Celo y USDC quedan
          dos monedas idénticas y se pierde de qué son. `filter` y `opacity`
          componen en GPU — no cuesta layout. */}
      {src && (
        <img
          src={src}
          alt=""
          draggable={false}
          className={`h-[36px] w-[36px] shrink-0 object-contain grayscale-[0.7] opacity-70 transition duration-300 group-hover:grayscale-0 group-hover:opacity-100 ${
            round ? "rounded-full" : ""
          }`}
        />
      )}
      {/* El color va por clase y NO por `style`: un color inline gana por
          especificidad y el group-hover no llegaría nunca a pintar. */}
      <span className="text-[18px] font-semibold tracking-tight text-[rgba(42,23,16,0.45)] transition-colors duration-300 group-hover:text-[#2A1710]">
        {alt}
      </span>
    </div>
  );
}

/** El loop. UNA sola tira con las dos familias juntas.
 *
 * Antes esto eran dos tiras quietas y separadas ("Corre sobre" / "De acá
 * leemos ingresos"). Se unen por una razón concreta: un marquee con cuatro
 * logos se lee como que estás estirando lo poco que tenés — el loop existe
 * para insinuar "hay muchos más". Con las dos familias juntas son NUEVE, que
 * es densidad suficiente para que el loop diga lo que tiene que decir.
 *
 * La etiqueta tiene que ser cierta de los nueve a la vez, y por eso no dice
 * "backed by" ni "trusted by": no hay inversores ni clientes en esta lista.
 * Todos son cosas con las que el producto está EFECTIVAMENTE integrado — el
 * vault sobre el que corre, la red que liquida, la moneda, las wallets que
 * traen usuarios y las apps de las que leemos ingresos.
 */
const LOOP_LOGOS: { src?: string; alt: string; nota: [string, string]; round?: boolean }[] = [
  // Los dos primeros salen de CADENA: en lendoor.xyz son Euler v2 + Celo, en
  // stellar.lendoor.xyz son Soroban + Stellar. Símbolo de Euler bajado de
  // euler.finance/brand.
  { src: CADENA.vault.logo, alt: CADENA.vault.nombre, nota: CADENA.vault.nota },
  { src: CADENA.redLogo, alt: CADENA.red, nota: ["La red que liquida", "The chain that settles"] },
  { src: "/usdc.svg", alt: "USDC", nota: ["La moneda de cada préstamo", "The currency of every loan"] },
  { src: "/lemon.png", alt: "Lemon", round: true, nota: ["Mini-app en producción", "Mini-app in production"] },
  { src: "/logos/metamask.svg", alt: "MetaMask", nota: ["Wallets externas", "External wallets"] },
];

function LogoLoop() {
  const t = useT();
  const { lang } = useLang();
  const caja = useRef<HTMLDivElement>(null);
  // Gateado por IntersectionObserver como todo lo demás en esta página: una
  // animación infinita que sigue corriendo fuera de pantalla es exactamente
  // el tipo de costo que nos hacía laggear en mobile.
  const [vivo, setVivo] = useState(false);
  useEffect(() => {
    const el = caja.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVivo(e.isIntersecting), { rootMargin: "200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    // py-5 = 20px arriba y abajo. Todos los bloques de primer nivel usan el
    // MISMO valor, así CUALQUIER par de lienzos contiguos queda separado por
    // 40px — el mismo hueco que el `mt-10` que ya separa los lienzos apilados
    // dentro de una sección. Antes cada sección traía su propio padding y los
    // huecos daban 56/96/20/60/40/60: la página se leía desacomodada.
    <section ref={caja} className="py-5">
      <style>{`
        @keyframes loopLogos { to { transform: translate3d(-50%, 0, 0) } }
        /* La pista se anima con translate3d: compone en GPU y no toca layout
           ni pinta, así que el costo por cuadro es ~0 aun con nueve celdas. */
        .pistaLogos {
          animation: loopLogos 42s linear infinite;
          will-change: transform;
        }
        .loopLogos:hover .pistaLogos { animation-play-state: paused }
        @media (prefers-reduced-motion: reduce) {
          .pistaLogos { animation: none }
        }
      `}</style>

      {/* Mismo canal que el resto de la página (`px-4 md:px-6` dentro del
          max-w-[1600px] del main): así los bordes del loop caen EXACTAMENTE
          donde caen los de la tarjeta del hero y los lienzos de abajo. Con un
          max-w-[1240px] propio la banda quedaba más angosta que todo lo demás
          y se leía desalineada. */}
      <div className="px-4 md:px-6">
        {/* Marco LIMPIO: blanco liso + un hairline, sin las luces naranjas de
            esquina del MarcoPlano. Con el lavado cálido la banda competía con
            el hero que tiene justo arriba (dos superficies naranjas pegadas);
            en blanco, lo único que dibuja el límite es el borde, que es lo que
            hace falta para que se alinee con el resto y nada más. */}
        <div
          className="relative isolate overflow-hidden rounded-[26px] py-10 md:py-12"
          style={{ backgroundColor: "#fff", border: `1px solid ${INK_10}` }}
        >
        <p
          className="mb-8 text-center font-mono text-[11px] font-bold uppercase tracking-[0.16em]"
          style={{ color: META }}
        >
          {t("Integrado con", "Connected to")}
        </p>

        {/* La máscara de bordes: los logos nacen y mueren en un fundido en vez
            de cortarse contra el filo del contenedor, que es lo que delata a
            un marquee mal hecho. */}
        <div
          className="loopLogos relative overflow-hidden"
          style={{
            maskImage: "linear-gradient(to right, transparent, #000 9%, #000 91%, transparent)",
            WebkitMaskImage: "linear-gradient(to right, transparent, #000 9%, #000 91%, transparent)",
          }}
        >
          {/* La pista lleva la lista DOS veces y se desplaza -50%: al terminar
              el primer juego, el segundo está exactamente donde arrancó el
              primero, así que el salto del loop es invisible. */}
          <div
            // El gap es GRANDE a propósito. Al quedar cinco logos, un ciclo
            // medía ~1000px y entraba entero en un viewport de 1440 — se veían
            // Celo y USDC dos veces AL MISMO TIEMPO, que se lee como un bug y
            // no como un loop. Separándolos, un ciclo pasa del ancho de
            // pantalla y nunca coexisten dos copias del mismo logo.
            className={`pistaLogos flex w-max items-center gap-x-16 md:gap-x-[240px] ${vivo ? "" : "[animation-play-state:paused]"}`}
          >
            {[0, 1].map((juego) =>
              LOOP_LOGOS.map((l) => (
                <CeldaLogo
                  key={`${juego}-${l.alt}`}
                  src={l.src}
                  alt={l.alt}
                  round={l.round}
                  nota={lang === "es" ? l.nota[0] : l.nota[1]}
                  // La copia duplicada es puro relleno visual: se esconde de
                  // lectores de pantalla para no leer la lista dos veces.
                  oculto={juego === 1}
                />
              )),
            )}
          </div>
        </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const t = useT();
  // Solo links que van a algún lado real. Tenía 6 entradas en "#" y dos a un
  // #docs que no existe — un footer con la mitad de los links muertos dice más
  // que cualquier copy. Documentación/Términos/Privacidad vuelven cuando
  // existan las páginas.
  const cols: [string, [string, string][]][] = [
    [t("Producto", "Product"), [
      [t("Para fintechs", "For fintechs"), "#top"],
      [t("Para suppliers", "For suppliers"), "#top"],
      [t("Cómo funciona", "How it works"), "#como"],
      [t("Prueba viva", "Living proof"), "#prueba"],
    ]],
    [t("Recursos", "Resources"), [
      [t("Contrato verificable", "Verifiable contract"), CADENA.contratoUrl],
      [t("Mini-app en Lemon", "Mini-app on Lemon"), "https://app.lendoor.xyz"],
    ]],
    [t("Compañía", "Company"), [
      [t("Contacto", "Contact"), "#acceso"],
      [t("Solicitar acceso", "Request access"), "#acceso"],
    ]],
  ];
  return (
    // El footer venía suelto sobre el fondo, con el degradado naranja del CTA
    // muriendo justo encima: se leía como el final de otra página pegado abajo.
    // Ahora es un lienzo redondeado más, igual que las secciones.
    <footer className="px-8 pb-6 pt-8 md:px-12">
      <div className="grid gap-9 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Wordmark size={15} />
        </div>
        {cols.map(([title, links]) => (
          <div key={title}>
            {/* tinta y no naranja: el naranja ya trabaja en los kickers y en
                el CTA; sumarlo acá sería un tercer estilo de etiqueta
                compitiendo por la misma atención */}
            <h4
              className="mb-3.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em]"
              style={{ color: INK }}
            >
              {title}
            </h4>
            <ul className="grid list-none gap-2.5 p-0" style={{ margin: 0 }}>
              {links.map(([label, href]) => (
                <li key={label}>
                  {/* inline-block + py-2: el link medía 17px de alto y hacía
                      falta apuntar. Con el padding llega a ~34 sin mover nada
                      visualmente, porque el gap de la lista lo absorbe. */}
                  <a
                    href={href}
                    className="inline-block py-2 text-sm no-underline hover:underline md:py-0"
                    style={{ color: INK_65 }}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </footer>
  );
}

// ── PÁGINA ──────────────────────────────────────────────────────────
export default function LandingV3() {
  const [side, setSide] = useState<Side>("fintech");
  const [lang, setLang] = useState<Lang>(detectarIdioma);
  // t local del root: las Filas se arman acá.
  const t = (es: string, en: string) => traducir(lang, es, en);
  useEffect(() => {
    try {
      localStorage.setItem("lendoor-lang", lang);
    } catch { /* modo incógnito sin storage: seguimos igual */ }
    document.documentElement.lang = lang;
    // Sólo "Lendoor". El título largo se cortaba en la pestaña —donde entran
    // ~20 caracteres— y sólo aparecía entero en el tooltip del hover, que
    // nadie mira. La bajada vive en la meta description, que es su lugar:
    // ahí sí la lee Google y la muestran los previews al compartir el link.
    document.title = "Lendoor";
    const md = document.querySelector('meta[name="description"]');
    if (md) {
      md.setAttribute(
        "content",
        lang === "es"
          ? "Infraestructura de crédito sin colateral para wallets y fintechs de LATAM. Ponemos el modelo de riesgo, el capital y la cobranza."
          : lang === "pt"
          ? "Infraestrutura de crédito sem colateral para wallets e fintechs da LATAM. Trazemos o modelo de risco, o capital e a cobrança."
          : "Uncollateralized credit infrastructure for LATAM wallets and fintechs. We bring the risk model, the capital and collections."
      );
    }
  }, [lang]);
  // Los anchors del nav (#como, #prueba, #acceso) transicionan en
  // vez de saltar. El scroller es #root (no <html>), y lo seteamos solo
  // mientras la landing está montada: en la app, ScrollToTop resetea scrollTop
  // por ruta y con smooth global ese reset se vería como un scrollazo animado.
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    const prev = root.style.scrollBehavior;
    root.style.scrollBehavior = "smooth";
    return () => { root.style.scrollBehavior = prev; };
  }, []);
  return (
    <LangCtx.Provider value={{ lang, setLang }}>
    <div
      id="top"
      // El rebote elástico al llegar a los extremos: #root lo tiene apagado
      // (overscroll-behavior-y: none) porque en el webview de Lemon el
      // pull-to-refresh arruina la mini-app. Pero esto es una página web y
      // sin rebote se siente rígida, como si el scroll chocara una pared.
      ref={(el) => {
        const r = document.getElementById("root");
        if (r) r.style.overscrollBehaviorY = el ? "auto" : "none";
      }}
      // index.css apaga user-select en <html> para que la mini-app se sienta
      // nativa dentro de Lemon. Esta es una página de marketing: acá copiar
      // (la dirección del contrato, el JSON del endpoint) es parte del uso.
      style={{ backgroundColor: BASE, color: INK, userSelect: "text", WebkitUserSelect: "text" }}
    >
      {/* Sin pre-loader (2026-08-14). Costaba ~2.4s de pantalla vacía antes
          de mostrar nada, y tapaba dos cosas que se resuelven sin bloquear:
          el salto de fuente y la compilación del shader. El canvas ahora
          entra con un fade cuando ya pintó su primer cuadro, y el resto del
          contenido aparece de inmediato. El componente queda en el archivo
          por si hay que volver. */}
      <BarraProgreso />
      <Nav />
      {/* Sin reglas verticales: era el device que traía el template. El
          encuadre ahora lo da el MarcoLuz del hero. */}
      <div className="relative mx-auto max-w-[1600px]">
      <main className="px-0">
        <Hero side={side} onSide={setSide} />
        {/* El loop va JUSTO acá, entre el hero y el primer lienzo. Dos
            razones: hace el trabajo de credibilidad con la atención todavía
            alta, y su movimiento horizontal amortigua el salto duro que había
            entre el hero y el bloque de abajo — una banda que se desliza es
            mejor transición que un corte seco.
            Es cierto de los dos lados (fintech y supplier), así que no se
            gatea por `side`. */}
        <LogoLoop />
        {side === "fintech" ? (
          <LoQuePonemos side={side} entreMedio={<ComoFunciona side={side} />} />
        ) : (
          // del lado supplier no existe LoQuePonemos, así que el navy va suelto
          <ComoFunciona side={side} />
        )}


        {/* Bloque de cierre: FAQ, CTA y footer comparten UN lienzo con el
            MISMO shader animado del hero. Es el segundo y último canvas vivo
            de la página (gateado por IntersectionObserver igual que aquel):
            se enciende recién cuando llegás al final, cuando el del hero ya
            quedó fuera de pantalla. */}
        <section className="px-4 pb-6 pt-5 md:px-6">
          <MarcoLuz side={side} className="pb-2">
            <Preguntas />
            <Footer />
          </MarcoLuz>
        </section>
      </main>
      </div>
    </div>
    </LangCtx.Provider>
  );
}
