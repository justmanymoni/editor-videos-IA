/**
 * Ready-made text looks ("plantillas"): titles, labels and boxed keywords in
 * the styles common in short vertical videos. A preset only fills in fields
 * of a normal text, so everything can be changed afterwards.
 */
import type { TextItem } from './types';

export interface TextPreset {
  id: string;
  name: string;
  /** Example wording shown in the thumbnail and used when the preset is added. */
  sample: string;
  style: Partial<Omit<TextItem, 'id' | 'text' | 'start' | 'duration'>>;
}

const plain = { outlineWidth: 0, shadow: 0 } as const;

export const TEXT_PRESETS: TextPreset[] = [
  {
    id: 'impacto',
    name: 'Título impacto',
    sample: 'ESTO CAMBIA\nTODO',
    style: { fontId: 'anton', fontSize: 150, color: '#FFFFFF', outlineWidth: 0, shadow: 8, y: 0.3, animIn: 'pop', animOut: 'fade' },
  },
  {
    id: 'clave',
    name: 'Palabra clave',
    sample: 'GRATIS',
    style: {
      ...plain,
      fontId: 'anton',
      fontSize: 150,
      color: '#111111',
      bgColor: '#FF6B35',
      bgRadius: 0.12,
      bgPadding: 0.22,
      rotation: -3,
      y: 0.42,
      animIn: 'pop',
      animOut: 'zoom',
    },
  },
  {
    id: 'etiqueta',
    name: 'Etiqueta',
    sample: 'PARTE 1 · MIRA HASTA EL FINAL',
    style: {
      ...plain,
      fontId: 'courier-prime',
      fontSize: 40,
      color: '#FFFFFF',
      bgColor: '#111111',
      bgRadius: 1,
      bgPadding: 0.7,
      y: 0.1,
      animIn: 'slide-down',
      animOut: 'fade',
    },
  },
  {
    id: 'azul',
    name: 'Destacado azul',
    sample: 'editado',
    style: { ...plain, fontId: 'poppins-extrabold', fontSize: 170, color: '#1463FF', y: 0.3, animIn: 'zoom', animOut: 'fade' },
  },
  {
    id: 'amarilla',
    name: 'Caja amarilla',
    sample: 'OJO A ESTO',
    style: {
      ...plain,
      fontId: 'montserrat-black',
      fontSize: 100,
      color: '#000000',
      bgColor: '#FFE600',
      bgRadius: 0.2,
      bgPadding: 0.28,
      animIn: 'slide-up',
      animOut: 'fade',
    },
  },
  {
    id: 'blanca',
    name: 'Caja blanca',
    sample: 'Lo que nadie te cuenta',
    style: {
      ...plain,
      fontId: 'inter-bold',
      fontSize: 66,
      color: '#111111',
      bgColor: '#FFFFFF',
      bgRadius: 0.45,
      bgPadding: 0.4,
      animIn: 'fade',
      animOut: 'fade',
    },
  },
  {
    id: 'negra',
    name: 'Caja negra',
    sample: 'Guárdalo para luego',
    style: {
      ...plain,
      fontId: 'montserrat-bold',
      fontSize: 62,
      color: '#FFFFFF',
      bgColor: '#000000',
      bgRadius: 0.35,
      bgPadding: 0.4,
      y: 0.78,
      animIn: 'slide-up',
      animOut: 'fade',
    },
  },
  {
    id: 'urgente',
    name: 'Última hora',
    sample: 'ÚLTIMA HORA',
    style: {
      ...plain,
      fontId: 'anton',
      fontSize: 110,
      color: '#FFFFFF',
      bgColor: '#E11D2E',
      bgRadius: 0.08,
      bgPadding: 0.25,
      rotation: -2,
      y: 0.2,
      animIn: 'slide-right',
      animOut: 'slide-right',
    },
  },
  {
    id: 'numero',
    name: 'Número',
    sample: '01',
    style: { fontId: 'anton', fontSize: 300, color: '#FFE600', outlineWidth: 10, shadow: 0, y: 0.3, animIn: 'zoom-out', animOut: 'fade' },
  },
  {
    id: 'pop',
    name: 'Rosa pop',
    sample: '¡BRUTAL!',
    style: {
      fontId: 'luckiest-guy',
      fontSize: 150,
      color: '#FF3D9A',
      outlineColor: '#FFFFFF',
      outlineWidth: 10,
      shadow: 8,
      rotation: -5,
      animIn: 'pop',
      animOut: 'zoom-out',
    },
  },
  {
    id: 'comic',
    name: 'Cómic',
    sample: 'BOOM',
    style: {
      fontId: 'bangers',
      fontSize: 190,
      color: '#FFE600',
      outlineColor: '#000000',
      outlineWidth: 10,
      shadow: 10,
      rotation: -6,
      animIn: 'pop',
      animOut: 'fade',
    },
  },
  {
    id: 'limpio',
    name: 'Limpio',
    sample: 'Una frase sencilla',
    style: { fontId: 'montserrat-bold', fontSize: 70, color: '#FFFFFF', outlineWidth: 4, shadow: 3, animIn: 'fade', animOut: 'fade' },
  },
  {
    id: 'elegante',
    name: 'Elegante',
    sample: 'Menos es más',
    style: { fontId: 'playfair-italic', fontSize: 96, color: '#FFFFFF', outlineWidth: 0, shadow: 5, animIn: 'fade', animOut: 'fade' },
  },
  {
    id: 'manuscrita',
    name: 'Manuscrita',
    sample: 'hecho con cariño',
    style: { fontId: 'pacifico', fontSize: 96, color: '#FFFFFF', outlineWidth: 0, shadow: 5, rotation: -4, animIn: 'zoom', animOut: 'fade' },
  },
  {
    id: 'maquina',
    name: 'Máquina de escribir',
    sample: 'Capítulo uno',
    style: {
      ...plain,
      fontId: 'courier-prime',
      fontSize: 64,
      color: '#111111',
      bgColor: '#F2EFE6',
      bgRadius: 0,
      bgPadding: 0.4,
      animIn: 'slide-left',
      animOut: 'fade',
    },
  },
  {
    id: 'arco',
    name: 'En arco',
    sample: 'NUEVO VÍDEO',
    style: {
      fontId: 'bebas-neue',
      fontSize: 120,
      color: '#FFFFFF',
      outlineWidth: 6,
      shadow: 4,
      curve: 'arc',
      curveAmount: 40,
      y: 0.25,
      animIn: 'zoom',
      animOut: 'fade',
    },
  },
];
