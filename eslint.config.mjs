import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next 16 ya publica configs en formato plano: se importan directamente,
// sin la capa de compatibilidad de @eslint/eslintrc.
const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", ".cache/**"] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // El guion bajo es la marca de "esto se descarta a propósito". Se usa al
      // desestructurar para quitar una clave de un objeto, que es como `stripModelState`
      // saca el `state` que el modelo no debería haber emitido.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
];

export default config;
