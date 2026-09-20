import { Schema, model, Document } from "mongoose";

export interface ICommandLogConfig extends Document {
  guildId: string;
  channelId: string;
  excludedUserIds: string[];
  excludedRoleIds: string[];
  createdAt: Date;
  updatedAt: Date;
}
const commandLogConfigSchema = new Schema<ICommandLogConfig>(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    channelId: { type: String, required: true },
    excludedUserIds: { type: [String], default: [] },
    excludedRoleIds: { type: [String], default: [] },
  },
  { timestamps: true }
);
export default model<ICommandLogConfig>("CommandLogConfig", commandLogConfigSchema);