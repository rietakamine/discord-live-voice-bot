import {
  AnySelectMenuInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  Collection,
  ContextMenuCommandBuilder,
  MessageContextMenuCommandInteraction,
  ModalSubmitInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";

export interface Command {
  data:
    | SlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | SlashCommandSubcommandsOnlyBuilder;
  guildOnly?: boolean;
  permissionKey?: string;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
  modalSubmit?: (interaction: ModalSubmitInteraction) => Promise<void>;
  componentInteraction?: (
    interaction: ButtonInteraction | AnySelectMenuInteraction
  ) => Promise<void>;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export interface ContextMenuCommand {
  data: ContextMenuCommandBuilder;
  guildOnly?: boolean;
  permissionKey?: string;
  modalSubmit?: (interaction: ModalSubmitInteraction) => Promise<void>;
  execute: (interaction: MessageContextMenuCommandInteraction) => Promise<void>;
}
export type AnyCommand = Command | ContextMenuCommand;
export interface BotEvent {
  name: string;
  once?: boolean;
  execute: (...args: any[]) => Promise<void> | void;
}
declare module "discord.js" {
  interface Client {
    commands: Collection<string, AnyCommand>;
  }
}