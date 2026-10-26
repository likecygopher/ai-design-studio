import { NextResponse } from "next/server";
import { requireUserId } from "@/src/platform/auth";
import { toErrorResponse } from "@/src/platform/http";
import { createUserWorkspace } from "@/src/platform/workspace";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    const products = await createUserWorkspace(userId).productRegistry.listProducts();
    return NextResponse.json({ products });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json().catch(() => null);
    const name = String(body?.name ?? "").trim();
    const category = String(body?.category ?? "").trim();
    if (!name || !category) {
      return NextResponse.json({ error: "请填写产品名称和品类。" }, { status: 400 });
    }

    const product = await createUserWorkspace(userId).productRegistry.createProduct({
      name,
      category,
      brand: body?.brand ? String(body.brand) : undefined,
      modelName: body?.modelName ? String(body.modelName) : undefined
    });
    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const productId = new URL(request.url).searchParams.get("productId")?.trim();
    if (!productId) {
      return NextResponse.json({ error: "缺少 productId。" }, { status: 400 });
    }
    const removed = await createUserWorkspace(userId).productRegistry.deleteProduct(productId);
    if (!removed) {
      return NextResponse.json({ error: "产品不存在。" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
