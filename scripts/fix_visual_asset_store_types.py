from pathlib import Path

path = Path("apps/consumer-alpha/src/visual-asset-store.ts")
text = path.read_text()
replacements = {
    "async markValidation(assetId, status, errors): Promise<void> {": "async markValidation(\n      assetId: string,\n      status: \"valid\" | \"invalid\",\n      errors: readonly string[],\n    ): Promise<void> {",
    "async markDeployed(assetIds): Promise<void> {": "async markDeployed(assetIds: readonly string[]): Promise<void> {",
    "async getReusable(assetIds): Promise<ReadonlyMap<string, StoredVisualAsset>> {": "async getReusable(\n      assetIds: readonly string[],\n    ): Promise<ReadonlyMap<string, StoredVisualAsset>> {",
    "async getSources(assetIds): Promise<ReadonlyMap<string, StoredVisualSource>> {": "async getSources(\n      assetIds: readonly string[],\n    ): Promise<ReadonlyMap<string, StoredVisualSource>> {",
}
for old, new in replacements.items():
    if old in text:
        text = text.replace(old, new, 1)
    elif new not in text:
        raise SystemExit(f"missing marker: {old}")
path.write_text(text)
print("visual-asset-store TypeScript parameter annotations fixed")
