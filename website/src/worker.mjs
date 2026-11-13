export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.kiwimake.ai" || url.protocol === "http:") {
      url.protocol = "https:";
      if (url.hostname === "www.kiwimake.ai") url.hostname = "kiwimake.ai";
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(request);
  },
};
