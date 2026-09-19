function requirePermissionsApi(permissionsApi) {
  if (!permissionsApi?.contains || !permissionsApi?.getAll || !permissionsApi?.remove) {
    throw new TypeError("The Chrome permissions API is required.");
  }
  return permissionsApi;
}

export async function retainOnlyOriginPermission(permissionsApi, selectedOrigin) {
  const api = requirePermissionsApi(permissionsApi);
  if (typeof selectedOrigin !== "string" || !selectedOrigin) {
    throw new TypeError("A selected origin permission is required.");
  }

  const permissions = await api.getAll();
  const unusedOrigins = [
    ...new Set(
      (permissions.origins ?? []).filter(
        (origin) => typeof origin === "string" && origin !== selectedOrigin,
      ),
    ),
  ];
  if (!unusedOrigins.length) {
    if (!(await api.contains({ origins: [selectedOrigin] }))) {
      throw new Error("Settings were saved, but selected site access was not retained.");
    }
    return Object.freeze([]);
  }

  const removed = await api.remove({ origins: unusedOrigins });
  if (!removed) {
    throw new Error("Settings were saved, but obsolete site access could not be removed.");
  }

  const remaining = (await api.getAll()).origins ?? [];
  if (remaining.some((origin) => unusedOrigins.includes(origin))) {
    throw new Error("Settings were saved, but obsolete site access could not be removed.");
  }
  if (!(await api.contains({ origins: [selectedOrigin] }))) {
    throw new Error("Settings were saved, but selected site access was not retained.");
  }

  return Object.freeze(unusedOrigins);
}
