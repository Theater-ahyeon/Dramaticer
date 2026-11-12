import { LiteKernel } from "../src/index.js";
import { describeKernel } from "./plugin-kernel-suite.js";

describeKernel("LiteKernel", () => new LiteKernel());
