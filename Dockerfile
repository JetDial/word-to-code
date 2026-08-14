# Word to Code — containerized browser mode.
#
# The desktop build is Electron and needs a display, so what runs here is the
# same UI served over HTTP (`npm run web`). Both offline engines work fully;
# Claude AI mode calls the API directly from your browser, so the key lives in
# the browser rather than in this image.
#
#   docker build -t word-to-code .
#   docker run --rm -p 4173:4173 word-to-code
#   open http://localhost:4173
#
# Run the test suite instead of the server:
#   docker build --target test .

# ---------------------------------------------------------------- test stage
FROM node:22-alpine AS test
WORKDIR /app
# The engines have no runtime dependencies, so the sources are all the tests need.
COPY package.json ./
COPY src/ ./src/
COPY test/ ./test/
RUN node --test

# ------------------------------------------------------------- runtime stage
FROM node:22-alpine AS runtime

# Fail the image build if the engines are broken.
COPY --from=test /app/package.json /tmp/test-passed.json

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173

# "type": "module" lives here, so the server needs it to load as ESM.
# There is no `npm install`: the app declares zero runtime dependencies, and
# Electron is a devDependency that is useless in a headless container.
COPY package.json ./
COPY src/ ./src/
COPY scripts/serve.js ./scripts/serve.js

# node:alpine ships an unprivileged `node` user; use it rather than root.
USER node

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=3s --start-period=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form: node is PID 1 and receives SIGTERM directly for a clean stop.
CMD ["node", "scripts/serve.js"]
