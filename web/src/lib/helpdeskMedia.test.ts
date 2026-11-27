/**
 * Testes unitários das funções puras de detecção de mídia e áudio do Help Desk / Contatos de suporte.
 * Rodar (Node >= 22.6):
 *   node --test src/lib/helpdeskMedia.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isInlinePlayableMedia, isPlaceholderAudioBody, mediaKind } from "./helpdeskMedia.ts";

describe("mediaKind", () => {
  it("reconhece áudios por mediaType (ptt, audio/*) e por extensão", () => {
    assert.equal(mediaKind("ptt", "/flask/helpdesk/api/media/123.ogg"), "audio");
    assert.equal(mediaKind("audio/ogg; codecs=opus", "/flask/helpdesk/api/media/abc"), "audio");
    assert.equal(mediaKind("audioMessage", null), "audio");
    assert.equal(mediaKind(null, "/flask/helpdesk/api/media/voz.mp3?v=1"), "audio");
    assert.equal(mediaKind("", "/flask/helpdesk/api/media/nota.m4a"), "audio");
    assert.equal(mediaKind("", "/flask/helpdesk/api/media/nota.opus"), "audio");
  });

  it("reconhece imagens, vídeos e arquivos genéricos", () => {
    assert.equal(mediaKind("image/jpeg", "/flask/helpdesk/api/media/foto.jpg"), "image");
    assert.equal(mediaKind("sticker", "/flask/helpdesk/api/media/fig.webp"), "image");
    assert.equal(mediaKind("video/mp4", "/flask/helpdesk/api/media/clipe.mp4"), "video");
    assert.equal(mediaKind("application/pdf", "/flask/helpdesk/api/media/doc.pdf"), "file");
  });
});

describe("isInlinePlayableMedia", () => {
  it("retorna true para áudio, imagem e vídeo, e false para anexos genéricos", () => {
    assert.equal(isInlinePlayableMedia("ptt", "voz.ogg"), true);
    assert.equal(isInlinePlayableMedia("image/png", "img.png"), true);
    assert.equal(isInlinePlayableMedia("video/mp4", "vid.mp4"), true);
    assert.equal(isInlinePlayableMedia("application/pdf", "boleto.pdf"), false);
  });
});

describe("isPlaceholderAudioBody", () => {
  it("identifica placeholders padrão de áudio", () => {
    assert.equal(isPlaceholderAudioBody(""), true);
    assert.equal(isPlaceholderAudioBody(null), true);
    assert.equal(isPlaceholderAudioBody("-"), true);
    assert.equal(isPlaceholderAudioBody("Áudio"), true);
    assert.equal(isPlaceholderAudioBody("  audio  "), true);
  });

  it("preserva legendas ou textos reais", () => {
    assert.equal(isPlaceholderAudioBody("Segue explicação do erro"), false);
  });
});
