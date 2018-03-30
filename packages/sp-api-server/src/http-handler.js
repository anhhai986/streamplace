import express from "express";
import winston from "winston";
import Resource, { SKContext } from "sp-resource";
import { config } from "sp-client";
import onFinished from "on-finished";
import apiLog from "./api-log";

const RETHINK_HOST = config.require("RETHINK_HOST");
const RETHINK_PORT = config.require("RETHINK_PORT");
const RETHINK_DATABASE = config.require("RETHINK_DATABASE");
const RETHINK_USER = config.optional("RETHINK_USER");
const RETHINK_PASSWORD = config.optional("RETHINK_PASSWORD");
const RETHINK_CA = config.optional("RETHINK_CA");

export default function httpHandler({ resource }) {
  const app = express();

  app.use(function(req, res, next) {
    const start = process.hrtime();
    onFinished(res, () => {
      const [small, big] = process.hrtime(start);
      const ms = (small * 1e3 + big * 1e-6).toFixed(3);
      const ctx = req.ctx || { remoteAddress: req.connection.remoteAddress };
      const url = req.originalUrl || req.url;
      const statusCode = res.statusCode;
      apiLog(ctx, `${req.method} ${url} ${statusCode} ${ms}ms`);
    });
    next();
  });

  const handleError = function(req, res, next, err) {
    if (!err) {
      err = {};
    }
    if (typeof err.status !== "number") {
      err.status = 500;
    }
    res.status(err.status);
    if (err.status >= 500) {
      winston.error(err);
    }
    // TODO: scrub message/stack if not dev
    res.json({
      message: err.message || "Unexpected Error",
      status: err.status,
      code: err.code || "UNEXPECTED_ERROR",
      stack: err.stack
    });
    next && next();
  };

  app.use((req, res, next) => {
    let ctx;
    const remoteAddress = req.connection.remoteAddress;
    SKContext.createContext({
      rethinkHost: RETHINK_HOST,
      rethinkPort: RETHINK_PORT,
      rethinkDatabase: RETHINK_DATABASE,
      rethinkUser: RETHINK_USER,
      rethinkPassword: RETHINK_PASSWORD,
      rethinkCA: RETHINK_CA,
      token: req.headers["sp-auth-token"],
      remoteAddress: remoteAddress,
      replaceToken: newToken => {
        res.header("sp-auth-token", newToken);
      }
    })
      .then(c => {
        ctx = c;
        req.ctx = ctx;
        next();
      })
      .catch(handleError.bind(this, req, res, null));
  });

  app.get("/", (req, res, next) => {
    Promise.resolve()
      .then(() => {
        let filter = {};
        if (req.query.filter) {
          try {
            filter = JSON.parse(req.query.filter);
          } catch (e) {
            throw new Resource.APIError({
              code: "MALFORMED_REQUEST",
              status: 400,
              message: "The 'filter' parameter must be in JSON format."
            });
          }
        }
        return resource.find(req.ctx, filter);
      })
      .then(docs => {
        res.status(200);
        res.json(docs);
        res.end();
      })
      .then(next)
      .catch(handleError.bind(this, req, res, next));
  });

  app.get("/:id", (req, res, next) => {
    resource
      .findOne(req.ctx, req.params.id)
      .then(doc => {
        if (doc) {
          res.status(200);
          res.json(doc);
          res.end();
          return next();
        } else {
          throw new Resource.NotFoundError();
        }
      })
      .catch(handleError.bind(this, req, res, next));
  });

  app.post("/", (req, res, next) => {
    resource
      .create(req.ctx, req.body)
      .then(newDoc => {
        res.status(201);
        res.json(newDoc);
        res.end();
        return next();
      })
      .catch(handleError.bind(this, req, res, next));
  });

  app.put("/:id", (req, res, next) => {
    resource
      .update(req.ctx, req.params.id, req.body)
      .then(newDoc => {
        res.status(200);
        res.json(newDoc);
        res.end();
        return next();
      })
      .catch(handleError.bind(this, req, res, next));
  });

  app.delete("/:id", (req, res, next) => {
    resource
      .delete(req.ctx, req.params.id)
      .then(() => {
        res.status(204);
        res.end();
        return next();
      })
      .catch(handleError.bind(this, req, res, next));
  });

  app.use((req, res, next) => {
    req.ctx.conn.close();
    next();
  });

  return app;
}
