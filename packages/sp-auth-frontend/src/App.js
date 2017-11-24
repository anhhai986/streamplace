import React, { Component } from "react";
import SP from "sp-client";
import qs from "qs";
import Auth0Login from "./Auth0Login";
import AuthorizeServer from "./AuthorizeServer";
import "./App.css";

/**
 * Pretty messy right now, but secure and gets the job done.
 */

const START = Symbol();
const LOGGED_IN = Symbol();
const LOGGED_OUT = Symbol();

class App extends Component {
  constructor() {
    super();
    const query = qs.parse(document.location.search.slice(1));
    this.state = {
      phase: START,
      logout: query.logout === "true",
      server: query.server || "stream.place",
      returnPath: query.returnPath || "/",
      noRedirect: query.noRedirect === "true",
      parentOrigin: `https://${query.server || "stream.place"}`
    };
    if (this.state.logout) {
      window.location = `https://${this.state.server}${this.state.returnPath}`;
      return;
    }
    this.communicationPromise = new Promise((resolve, reject) => {
      window.addEventListener("message", e => {
        if (e.origin !== this.state.parentOrigin) {
          SP.error(`Rejected message from unknown origin ${e.origin}`);
          return;
        }
        if (e.data === "hello") {
          this.setState({
            parentWindow: e.source
          });
          this.tellParent("hello");
          SP.info(
            `Bidirectional communication with ${
              this.state.parentOrigin
            } established.`
          );
          resolve();
        }
      });
    });
  }

  tellParent(message) {
    return this.communicationPromise.then(() => {
      this.state.parentWindow.postMessage(message, this.state.parentOrigin);
    });
  }

  componentWillMount() {
    if (this.state.logout) {
      return;
    }
    // This SPClient might not succeed in connection to the server 'cuz we're the login page, but
    // that's fine because we're just using it to get the schema.
    SP.connect()
      .then(user => {
        this.setState({ phase: LOGGED_IN });
      })
      .catch(err => {
        this.setState({ phase: LOGGED_OUT });
      });
  }

  componentDidMount() {}

  handleLogin(token) {
    this.setState({ phase: START });
    SP.connect({ token })
      .then(user => {
        this.setState({ phase: LOGGED_IN });
      })
      .catch(err => {
        SP.error(err);
        this.setState({ phase: LOGGED_OUT });
      });
  }

  handleToken(token) {
    window.location = `https://${this.state.server}${
      this.state.returnPath
    }?${qs.stringify({ token })}`;
  }

  handleRejected() {
    // window.close();
  }

  render() {
    if (this.state.phase === START) {
      return <div />;
    } else if (this.state.phase === LOGGED_IN) {
      return (
        <AuthorizeServer
          server={this.state.server}
          returnPath={this.state.returnPath}
          onToken={this.handleToken.bind(this)}
          onRejected={this.handleRejected.bind(this)}
        />
      );
    } else if (this.state.phase === LOGGED_OUT) {
      const { auth0Audience, auth0Domain } = SP.schema.plugins["sp-auth"];
      return (
        <Auth0Login
          auth0Audience={auth0Audience}
          auth0Domain={auth0Domain}
          onLogin={this.handleLogin.bind(this)}
        />
      );
    }
  }
}

export default App;
