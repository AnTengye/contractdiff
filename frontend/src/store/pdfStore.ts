// PDF store - manages PDF viewer state
import { Store } from './Store';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Annotations } from '@/types';
import { ZOOM } from '@/constants';

interface PdfState {
  leftDoc: PDFDocumentProxy | null;
  rightDoc: PDFDocumentProxy | null;
  zoomLevel: number;
  leftAnnotations: Annotations;
  rightAnnotations: Annotations;
}

const initialState: PdfState = {
  leftDoc: null,
  rightDoc: null,
  zoomLevel: ZOOM.DEFAULT,
  leftAnnotations: {},
  rightAnnotations: {},
};

export const pdfStore = new Store(initialState);

// Selectors
export const selectZoomLevel = (state: PdfState) => state.zoomLevel;
export const selectLeftDoc = (state: PdfState) => state.leftDoc;
export const selectRightDoc = (state: PdfState) => state.rightDoc;

// Actions
export const pdfActions = {
  setLeftDoc(doc: PDFDocumentProxy | null) {
    pdfStore.setState({ leftDoc: doc });
  },

  setRightDoc(doc: PDFDocumentProxy | null) {
    pdfStore.setState({ rightDoc: doc });
  },

  setZoom(level: number) {
    const clamped = Math.max(ZOOM.MIN, Math.min(ZOOM.MAX, level));
    pdfStore.setState({ zoomLevel: clamped });
  },

  changeZoom(delta: number) {
    const current = pdfStore.getState().zoomLevel;
    pdfActions.setZoom(current + delta);
  },

  setAnnotations(left: Annotations, right: Annotations) {
    pdfStore.setState({ leftAnnotations: left, rightAnnotations: right });
  },

  reset() {
    pdfStore.reset(initialState);
  },
};

export type { PdfState };
