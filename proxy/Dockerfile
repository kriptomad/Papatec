# Proxy de borda do PapaTec ERP
# É o mesmo nginx oficial, apenas com o utilitário `openssl` adicionado,
# para que o container gere sozinho o certificado auto-assinado na primeira
# subida (quando a pasta ./certs estiver vazia).
FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

EXPOSE 80 443
