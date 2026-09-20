import mongoose, { Schema, Document, Model } from "mongoose";

export interface ICommandPermission extends Document {
  guildId: string;
  permissionKey: string;
  roleIds: string[];
}
const commandPermissionSchema = new Schema<ICommandPermission>({
  guildId: { type: String, required: true, index: true },
  permissionKey: { type: String, required: true },
  roleIds: { type: [String], default: [] },
});
commandPermissionSchema.index({ guildId: 1, permissionKey: 1 }, { unique: true });
export default (mongoose.models.CommandPermission as Model<ICommandPermission>) ||
  mongoose.model<ICommandPermission>("CommandPermission", commandPermissionSchema);