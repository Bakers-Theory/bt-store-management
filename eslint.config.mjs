import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/** @type {import('eslint').Linter.Config[]} */
const config = [
  ...nextCoreWebVitals,
  {
    rules: {
      // Surfaced by the react-hooks v7 plugin bundled with eslint-config-next 16.
      // Flags pre-existing effect patterns; downgraded to a warning so the package
      // upgrade doesn't force an app-wide effect refactor.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    ignores: [".next/**", "node_modules/**"],
  },
];

export default config;
