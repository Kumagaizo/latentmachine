function stripFence(text) {
  return String(text ?? "").trim().replace(/^```[\w-]*\s*/i, "").replace(/\s*```$/i, "");
}

export function detectUnsupportedFormat(text) {
  const source = stripFence(text);
  if (!source) return null;

  if (/\{\{-?\s*(?:\.Values|include|toYaml|range|if|with)\b/.test(source)) {
    return {
      id: "helm-template",
      label: "Helm template",
      message: "Helm templates are not supported yet. Paste rendered YAML or JSON before transforming.",
    };
  }

  if (/^\s*(?:resource|module|variable|output|provider|data)\s+"[^"]+"/m.test(source) || /^\s*locals\s*\{/m.test(source)) {
    return {
      id: "terraform-hcl",
      label: "Terraform HCL",
      message: "Terraform HCL is not supported yet. Paste Terraform JSON-shaped values instead of raw .tf syntax.",
    };
  }

  return null;
}
