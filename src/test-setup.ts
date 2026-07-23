import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Without vitest's `globals: true`, @testing-library/react can't auto-detect the test
// framework's afterEach to clean up between tests, so it's wired up explicitly here.
afterEach(cleanup);
