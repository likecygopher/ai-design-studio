import type { PdpDocument, PdpSection } from "./pdp";
import {
  buildDefaultPdpCanvasLayout,
  getPdpCanvasColumnLabel,
  type PdpCanvasBlock,
  type PdpCanvasLayout
} from "./pdp-canvas-layout";

export type RenderPdpSvgOptions = {
  imageDataUris?: Record<string, string>;
  specification?: Array<[string, string]>;
  layout?: PdpCanvasLayout;
  brandImageDataUri?: string;
};

export type VerticalPdpExportMetrics = {
  sellingPointCount?: number;
  specificationCount?: number;
};

export function buildVerticalPdpExportLayout(
  source: PdpCanvasLayout,
  metrics: VerticalPdpExportMetrics = {}
): PdpCanvasLayout {
  const width = 920;
  const padding = 44;
  const gap = 24;
  const contentWidth = width - padding * 2;
  let y = 44;
  const kindOrder: Record<PdpCanvasBlock["kind"], number> = {
    brand: 0,
    kv: 1,
    "selling-point": 2,
    features: 3,
    specification: 4
  };
  const blocks = source.blocks
    .slice()
    .sort(
      (left, right) =>
        kindOrder[left.kind] - kindOrder[right.kind] ||
        (left.priority ?? 0) - (right.priority ?? 0) ||
        left.y - right.y ||
        left.x - right.x
    )
    .map((block) => {
      const height = verticalExportBlockHeight(block, contentWidth, metrics);
      const next = { ...block, x: padding, y, width: contentWidth, height };
      y += height + gap;
      return next;
    });

  return { width, height: y + 42, blocks };
}

function verticalExportBlockHeight(
  block: PdpCanvasBlock,
  contentWidth: number,
  metrics: VerticalPdpExportMetrics
): number {
  if (block.kind === "brand") {
    return Math.round(contentWidth * (941 / 875));
  }
  if (block.kind === "kv" || block.kind === "selling-point") {
    return Math.max(
      1,
      Math.round(contentWidth * (block.height / Math.max(1, block.width)))
    );
  }
  if (block.kind === "features") {
    const rows = Math.max(1, Math.ceil((metrics.sellingPointCount ?? 0) / 3));
    return 44 + rows * 86 + 24;
  }
  if (block.kind === "specification") {
    const rows = Math.max(1, metrics.specificationCount ?? 0);
    return 44 + rows * 36 + 12;
  }

  return Math.round(contentWidth * (block.height / Math.max(1, block.width)));
}

export function renderPdpSvg(
  document: PdpDocument,
  productName: string,
  options: RenderPdpSvgOptions = {}
): string {
  const imageDataUris = options.imageDataUris ?? {};
  const specification = options.specification ?? [];
  const sourceLayout =
    options.layout ??
    buildDefaultPdpCanvasLayout(
      document.sections.map((section) => ({
        id: section.sellingPointId,
        priority: section.order,
        enabled: true
      }))
    );
  const layout = buildVerticalPdpExportLayout(sourceLayout, {
    sellingPointCount: document.sections.length,
    specificationCount: specification.length
  });
  const sectionById = new Map(
    document.sections.map((section) => [section.sellingPointId, section])
  );

const blocks = layout.blocks
    .map((block) =>
      renderBlock(
        block,
        document,
        productName,
        sectionById,
        imageDataUris,
        specification,
        options.brandImageDataUri
      )
    )
    .filter(Boolean)
    .join("\n");

  const label = `${productName} | ${document.country} / ${document.language} | PDP ${document.templateVersion}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">
  <defs>
    <pattern id="pdp-grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#e4e9ee" stroke-width="1"/>
    </pattern>
    <filter id="pdp-shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#17202a" flood-opacity="0.10"/>
    </filter>
  </defs>
  <rect width="${layout.width}" height="${layout.height}" fill="#d3d6da"/>
${blocks}
  <text x="40" y="${layout.height - 22}" font-family="Arial, sans-serif" font-size="12" fill="#5f6c7b">${escapeXml(label)}</text>
</svg>`;
}

function renderBlock(
  block: PdpCanvasBlock,
  document: PdpDocument,
  productName: string,
  sectionById: Map<string, PdpSection>,
  imageDataUris: Record<string, string>,
  specification: Array<[string, string]>,
  brandImageDataUri?: string
): string {
  let body = "";

  if (block.kind === "brand") {
    body = brandBlock(block, document, brandImageDataUri);
  } else if (block.kind === "kv") {
    body = kvBlock(
      block,
      document,
      productName,
      imageDataUris[document.cover.imageAssetId]
    );
  } else if (block.kind === "selling-point" && block.sellingPointId) {
    const section = sectionById.get(block.sellingPointId);
    if (!section) {
      return "";
    }
    body = sellingPointBlock(
      block,
      section,
      section.largeImageAssetId
        ? imageDataUris[section.largeImageAssetId]
        : undefined
    );
  } else if (block.kind === "features") {
    body = featuresBlock(block, document);
  } else if (block.kind === "specification") {
    body = specificationBlock(block, specification);
  }

  return `  <g data-block-id="${escapeXml(block.id)}" data-kind="${block.kind}" transform="translate(${block.x} ${block.y})" filter="url(#pdp-shadow)">
${body}
  </g>`;
}

function brandBlock(
  block: PdpCanvasBlock,
  document: PdpDocument,
  brandImageDataUri?: string
): string {
  const imageHref = brandImageDataUri || "/pdp/midea-brand-no1.png";
  const brandStatement = document.brandMessage?.trim();

  const imageLayer = `    <rect width="${block.width}" height="${block.height}" fill="#ffffff" stroke="#cfd7df"/>
    <image href="${escapeXml(imageHref)}" width="${block.width}" height="${block.height}" preserveAspectRatio="xMidYMid meet"/>`;

  // The brand statement is the user-editable claim captured by the PDP export
  // API (`brandMessage`); it must survive into the rendered SVG instead of
  // being silently dropped by the image-only brand banner.
  if (!brandStatement) {
    return imageLayer;
  }

  const panelHeight = Math.round(block.height * 0.2);
  const panelY = block.height - panelHeight;
  const messageLines = wrapText(
    brandStatement,
    Math.max(36, Math.floor(block.width / 10)),
    3
  );
  const lineHeight = Math.max(16, Math.round(block.width / 40));
  const fontSize = Math.max(14, Math.round(block.width / 52));

  return `${imageLayer}
    <rect y="${panelY}" width="${block.width}" height="${panelHeight}" fill="#ffffff" fill-opacity="0.94"/>
${svgCenteredTextLines(messageLines, 0, panelY, block.width, panelHeight, lineHeight, fontSize, "#3f4549", 600)}`;
}

function kvBlock(
  block: PdpCanvasBlock,
  document: PdpDocument,
  productName: string,
  imageDataUri: string | undefined
): string {
  const titleHeight = clamp(Math.round(block.height * 0.10), 58, 120);
  const subtitleHeight = clamp(Math.round(block.height * 0.08), 48, 96);
  const imageHeight = block.height - titleHeight - subtitleHeight;
  const titleLines = wrapText(
    document.cover.title || productName,
    Math.max(20, Math.floor(block.width / 16)),
    2
  );
  const subtitleLines = wrapText(
    document.cover.subtitle || "Product overview",
    Math.max(24, Math.floor(block.width / 13)),
    3
  );

  return `    <rect width="${block.width}" height="${block.height}" fill="#d9dde3" stroke="#b9c0c7"/>
${imageBlock(imageDataUri, 0, 0, block.width, imageHeight, block.id, "KV")}
    <rect y="${imageHeight}" width="${block.width}" height="${titleHeight}" fill="#bcc2c8"/>
${svgCenteredTextLines(titleLines, 18, imageHeight, block.width - 36, titleHeight, 25, 22, "#26323c", 800)}
    <rect y="${imageHeight + titleHeight}" width="${block.width}" height="${subtitleHeight}" fill="#d9dde3"/>
${svgCenteredTextLines(subtitleLines, 20, imageHeight + titleHeight, block.width - 40, subtitleHeight, 19, 16, "#4d5964", 500)}`;
}

function sellingPointBlock(
  block: PdpCanvasBlock,
  section: PdpSection,
  imageDataUri: string | undefined
): string {
  if ((block.level ?? 1) >= 3) {
    return wideSellingPointBlock(block, section, imageDataUri);
  }

  const titleHeight = Math.round(block.height * 0.20);
  const descriptionHeight = Math.round(block.height * 0.18);
  const imageHeight = Math.max(42, block.height - titleHeight - descriptionHeight);
  const fontSize = clamp(Math.round(block.width / 38), 16, 24);
  const titleLines = wrapText(
    section.blackTitle,
    Math.max(18, Math.floor(block.width / (fontSize * 0.6))),
    2
  );
  const descriptionLines = wrapText(
    section.narrowGrayText,
    Math.max(24, Math.floor(block.width / 13)),
    3
  );

  return `    <rect width="${block.width}" height="${block.height}" fill="#d9dde3" stroke="#b9c0c7"/>
    <rect width="${block.width}" height="${titleHeight}" fill="#bcc2c8"/>
${svgCenteredTextLines(titleLines, 20, 0, block.width - 40, titleHeight, fontSize + 5, fontSize, "#26323c", 800)}
    <text x="${block.width - 14}" y="22" text-anchor="end" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#66717b">P${section.order}</text>
    <rect y="${titleHeight}" width="${block.width}" height="${descriptionHeight}" fill="#d9dde3"/>
${svgCenteredTextLines(descriptionLines, 24, titleHeight, block.width - 48, descriptionHeight, 19, 15, "#4d5964", 500)}
${imageBlock(
    imageDataUri,
    0,
    titleHeight + descriptionHeight,
    block.width,
    imageHeight,
    block.id,
    "IMAGE"
  )}`;
}

function wideSellingPointBlock(
  block: PdpCanvasBlock,
  section: PdpSection,
  imageDataUri: string | undefined
): string {
  const imageOnLeft = section.order % 2 === 1;
  const imageWidth = Math.round(block.width / 2);
  const textWidth = block.width - imageWidth;
  const imageX = imageOnLeft ? 0 : textWidth;
  const textX = imageOnLeft ? imageWidth : 0;
  const titleHeight = Math.round(block.height * 0.43);
  const titleLines = wrapText(
    section.blackTitle,
    Math.max(14, Math.floor(textWidth / 15)),
    2
  );
  const descriptionLines = wrapText(
    section.narrowGrayText,
    Math.max(18, Math.floor(textWidth / 12)),
    3
  );

  return `    <rect width="${block.width}" height="${block.height}" fill="#d9dde3" stroke="#b9c0c7"/>
${imageBlock(imageDataUri, imageX, 0, imageWidth, block.height, block.id, "IMAGE")}
    <rect x="${textX}" width="${textWidth}" height="${titleHeight}" fill="#bcc2c8"/>
${svgCenteredTextLines(titleLines, textX + 16, 0, textWidth - 32, titleHeight, 19, 16, "#26323c", 800)}
    <rect x="${textX}" y="${titleHeight}" width="${textWidth}" height="${block.height - titleHeight}" fill="#d9dde3"/>
${svgCenteredTextLines(descriptionLines, textX + 18, titleHeight, textWidth - 36, block.height - titleHeight, 16, 13, "#4d5964", 500)}`;
}

function featuresBlock(block: PdpCanvasBlock, document: PdpDocument): string {
  const headerHeight = 44;
  const columns = 3;
  const cellWidth = block.width / columns;
  const rowHeight = 86;
  const icons = document.sections
    .map((section, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const centerX = column * cellWidth + cellWidth / 2;
      const centerY = headerHeight + 32 + row * rowHeight;
      const labelLines = wrapText(section.blackTitle, 13, 2);
      return `    <circle cx="${centerX}" cy="${centerY}" r="18" fill="#ffffff" stroke="#9aa7b4"/>
    <text x="${centerX}" y="${centerY + 4}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" font-weight="800" fill="#057ca2">${index + 1}</text>
${svgTextLines(
  labelLines,
  column * cellWidth + 4,
  centerY + 26,
  10,
  8,
  "#3c4b5d",
  600,
  "middle",
  centerX
)}`;
    })
    .join("\n");

  return `    <rect width="${block.width}" height="${block.height}" fill="#eef0f2" stroke="#b9c0c7"/>
    <rect width="${block.width}" height="${headerHeight}" fill="#bcc2c8"/>
    <text x="${block.width / 2}" y="28" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#26323c">More Features</text>
${icons}`;
}

function specificationBlock(
  block: PdpCanvasBlock,
  specification: Array<[string, string]>,
  brandImageDataUri?: string
): string {
  const headerHeight = 44;
  const rowHeight = Math.min(
    42,
    Math.max(28, (block.height - headerHeight - 12) / Math.max(specification.length, 1))
  );
  const rows = specification
    .map(([name, value], index) => {
      const y = headerHeight + index * rowHeight;
      return `    <rect y="${y}" width="${block.width}" height="${rowHeight}" fill="${
        index % 2 === 0 ? "#ffffff" : "#eef1f4"
      }" stroke="#d9dde3"/>
    <text x="8" y="${y + rowHeight / 2 + 3}" font-family="Arial, sans-serif" font-size="8" font-weight="700" fill="#17202a">${escapeXml(
      truncate(name, 18)
    )}</text>
    <text x="${block.width * 0.48}" y="${y + rowHeight / 2 + 3}" font-family="Arial, sans-serif" font-size="8" fill="#5f6c7b">${escapeXml(
      truncate(value, 20)
    )}</text>`;
    })
    .join("\n");

  return `    <rect width="${block.width}" height="${block.height}" fill="#eef0f2" stroke="#b9c0c7"/>
    <rect width="${block.width}" height="${headerHeight}" fill="#bcc2c8"/>
    <text x="${block.width / 2}" y="28" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="#26323c">Specification</text>
${rows}`;
}

function imageBlock(
  dataUri: string | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  clipKey: string,
  label: string
): string {
  if (dataUri) {
    const clipId = `pdp-clip-${clipKey.replace(/[^a-zA-Z0-9-]/g, "")}`;
    return `    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#d9dde3"/>
    <clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}"/></clipPath>
    <image href="${escapeXml(dataUri)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" clip-path="url(#${clipId})"/>`;
  }

  const centerX = x + width / 2;
  const centerY = y + height / 2;
  return `    <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#d9dde3"/>
    <rect x="${centerX - 17}" y="${centerY - 14}" width="34" height="28" fill="none" stroke="#b9c4ce"/>
    <path d="M ${centerX - 13} ${centerY + 9} L ${centerX - 2} ${centerY - 2} L ${centerX + 5} ${centerY + 5} L ${centerX + 13} ${centerY - 5}" fill="none" stroke="#b9c4ce"/>
    <text x="${centerX}" y="${centerY + 30}" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" font-weight="700" fill="#7d8a98">${label}</text>`;
}

function svgCenteredTextLines(
  lines: string[],
  x: number,
  y: number,
  width: number,
  height: number,
  lineHeight: number,
  fontSize: number,
  color: string,
  weight: number
): string {
  const textX = x + width / 2;
  const firstLineY = y + height / 2 - ((lines.length - 1) * lineHeight) / 2;
  return `    <text x="${textX}" y="${firstLineY}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${color}">${lines
    .map(
      (line, index) =>
        `<tspan x="${textX}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
    )
    .join("")}</text>`;
}

function svgTextLines(
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
  fontSize: number,
  color: string,
  weight: number,
  anchor: "start" | "middle" = "start",
  anchorX?: number
): string {
  const textX = anchorX ?? x;
  return `    <text x="${textX}" y="${y}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${color}">${lines
    .map(
      (line, index) =>
        `<tspan x="${textX}" dy="${index === 0 ? lineHeight : lineHeight}">${escapeXml(
          line
        )}</tspan>`
    )
    .join("")}</text>`;
}

function wrapText(value: string, maxChars: number, maxLines: number): string[] {
  const clean = value.trim();
  if (!clean) {
    return [""];
  }

  const tokens = clean.includes(" ") ? clean.split(/\s+/) : Array.from(clean);
  const joiner = clean.includes(" ") ? " " : "";
  const lines: string[] = [];
  let current = "";

  for (const token of tokens) {
    const next = current ? `${current}${joiner}${token}` : token;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = token;
      if (lines.length === maxLines) {
        break;
      }
    } else {
      current = next;
    }
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  if (lines.length === maxLines && lines.join(joiner).length < clean.length) {
    lines[maxLines - 1] = truncate(lines[maxLines - 1], Math.max(2, maxChars));
  }

  return lines;
}

function uniqueColumnHeaders(blocks: PdpCanvasBlock[]): PdpCanvasBlock[] {
  const seen = new Set<string>();
  return blocks
    .slice()
    .sort((left, right) => left.x - right.x || left.y - right.y)
    .filter((block) => {
      const key =
        block.kind === "selling-point" ? `selling-point-${block.level ?? 1}` : block.kind;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
