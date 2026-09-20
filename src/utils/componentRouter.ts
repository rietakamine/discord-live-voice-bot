import {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from "discord.js";

export type ComponentHandler = (
  interaction: ButtonInteraction | StringSelectMenuInteraction
) => Promise<void>;
export type ModalHandler = (interaction: ModalSubmitInteraction) => Promise<void>;
const componentHandlers = new Map<string, ComponentHandler>();
const modalHandlers = new Map<string, ModalHandler>();
export function registerComponentHandler(prefix: string, handler: ComponentHandler): void {
  if (componentHandlers.has(prefix)) {
    throw new Error(`A component handler is already registered for prefix "${prefix}"`);
  }
  componentHandlers.set(prefix, handler);
}
export function registerModalHandler(prefix: string, handler: ModalHandler): void {
  if (modalHandlers.has(prefix)) {
    throw new Error(`A modal handler is already registered for prefix "${prefix}"`);
  }
  modalHandlers.set(prefix, handler);
}

export function findComponentHandler(customId: string): ComponentHandler | undefined {
  for (const [prefix, handler] of componentHandlers) {
    if (customId.startsWith(prefix)) return handler;
  }
  return undefined;
}
export function findModalHandler(customId: string): ModalHandler | undefined {
  for (const [prefix, handler] of modalHandlers) {
    if (customId.startsWith(prefix)) return handler;
  }
  return undefined;
}