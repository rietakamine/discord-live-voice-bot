import mongoose from "mongoose";
import config from "./config";
import { logger } from "./logger";

export async function connectDatabase(): Promise<void> {
  mongoose.set("strictQuery", true);

  mongoose.connection.on("connected", () => logger.info("MongoDB connected"));
  mongoose.connection.on("error", (err) => logger.error("MongoDB connection error:", err));
  mongoose.connection.on("disconnected", () => logger.warn("MongoDB disconnected"));

  await mongoose.connect(config.mongoUri);
}
