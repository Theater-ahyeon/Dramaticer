import { LiteKernel } from "../src/index.js";
import { describeKernel } from "./kernel-suite.js";

describeKernel("自研精简内核原型", () => new LiteKernel());
