import "@testing-library/jest-dom/vitest";
import { expect } from "vitest";
import { toHaveNoViolations } from "vitest-axe";

expect.extend({ toHaveNoViolations });
