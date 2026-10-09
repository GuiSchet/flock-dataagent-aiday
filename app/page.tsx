import { AgentApp } from "@/components/AgentApp";
import { exampleQuestions } from "@/lib/conversation/examples";
import { getCatalogSummary } from "@/lib/data/catalog";
import { buildDashboard } from "@/lib/dashboard/tablero";
import { dataOverview } from "@/lib/data/overview";

/**
 * La única pantalla del producto: el tablero de la nómina y, al hablar, la conversación.
 *
 * El tablero, los ejemplos y el resumen de qué se puede preguntar se arman acá, en el
 * servidor, porque salen del catálogo y el catálogo se lee de `data/` con `node:fs`. La
 * página es estática: después de `npm run data:synthetic` hay que volver a construirla.
 */
export default function HomePage() {
  return (
    <AgentApp
      examples={exampleQuestions(getCatalogSummary())}
      overview={dataOverview()}
      dashboard={buildDashboard()}
    />
  );
}
