/**
 * Think of this like Redux's "connect". It exports some functions that make it really easy for SP
 * react components to bind themselves to SP API objects.
 *
 * If I were doing everything from scratch, I'd probably just have sp-client use Redux internally;
 * it already uses some really similar methods. That may still be in the cards. But hopefully
 * using these methods here means we won't have to change any of our components when that internal
 * refactor happens.
 */

import PropTypes from "prop-types";

import React, { Component } from "react";

/**
 * This maintains all of our watcher singletons. They're hashed by a simple string representation
 * of their arguments.
 */
const watcherSingletons = {};

/**
 * Helper function to tersely express monitoring changes of a Streamplace API object. This
 * function will always return the same object for the same incoming parameters. I think the word
 * for that is "memoized" but it's been a while.
 *
 * @param  {string} resource Resource to watch
 * @param  {Object} filter   Data filters to apply to the watch
 * @param  {Object} options
 */
export function watch(resource, filter, options = {}) {
  // TODO: This string representation got us started, but this function is called a LOT and so we
  // should try and make it faster than this. Unless this string thing is truly the fastest way?
  const key = `${resource}-${JSON.stringify(filter)}-${JSON.stringify(
    options
  )}`;
  if (!watcherSingletons[key]) {
    watcherSingletons[key] = { key, resource, filter, options };
  }
  return watcherSingletons[key];
}

/**
 * Common special case of watch() where we know there only exists one of the thing.
 * @param  {string} resource Resource to watch
 * @param  {Object} filter   Data filters to apply to the watch
 * @param  {Object} options  {one: true}
 * @return {Object}
 */
watch.one = function(resource, filter, options = {}) {
  return watch(resource, filter, { ...options, one: true });
};

/**
 * This is the superclass that wraps all components that want to be bound to Streamplace API
 * objects.
 */
export class SPBinding extends Component {
  static contextTypes = {
    SP: PropTypes.object.isRequired
  };

  constructor(props, { SP }) {
    super();
    this.previousWatchers = {};
    this.handles = {};
    this.state = { SP };
  }

  componentWillMount() {
    this.resubscribe(this.props);
  }

  componentWillReceiveProps(newProps) {
    this.resubscribe(newProps);
  }

  /**
   * Every time any value changes, we need to make sure that didn't cause it to change our
   * watchers. This function makes that check. This code path needs to be as fast as possible, so
   * be kinda careful.
   *
   * "But Eli, this isn't really all that optimized right now!"
   *
   * yeah, yeah, do as I say, not as I do, etc
   */
  resubscribe(props = this.props, state = this.state) {
    const newWatch = this.constructor.BoundComponent.subscribe({
      ...props,
      ...state
    });
    const oldWatch = this.previousWatchers;

    // Collect all the watch keys, old and new.
    const allKeys = [
      ...new Set([
        ...Object.keys(newWatch),
        ...Object.keys(this.previousWatchers)
      ])
    ];
    const changedKeys = allKeys.filter(key => newWatch[key] !== oldWatch[key]);

    if (changedKeys.length === 0) {
      return;
    }

    const { SP } = this.context;
    if (!SP) {
      throw new Error("Missing SP in context somehow. This shouldn't happen.");
    }

    changedKeys.forEach(key => {
      // If it existed before, unsubscribe from that changefeed.
      if (oldWatch[key]) {
        this.handles[key].stop();
        delete this.handles[key];
        this.setState({ [key]: null });
      }

      // If it exists now, subscribe to a new changefeed.
      if (newWatch[key]) {
        const { resource, filter, options } = newWatch[key];
        if (!SP[resource]) {
          throw new Error(
            `Tried to watch ${resource} but I've never heard of that resource`
          );
        }
        this.handles[key] = SP[resource]
          .watch(filter)
          .on("data", data => {
            if (options.one) {
              data = data[0];
            }
            // setState isn't sync, but we need to call resubscribe right away with the new data, so
            // here we are.
            const mod = { [key]: data };
            this.setState(mod);
            // This line right here is why this code needs to be so dang fast
            this.resubscribe(this.props, { ...this.state, ...mod });
          })
          .catch(err => {
            SP.error("Error setting up watch", err);
          });
      }
    });

    this.previousWatchers = newWatch;
  }

  /**
   * We're leaving! Don't let the unsubscribe calls hit you on the way out!
   */
  componentWillUnmount() {
    Object.keys(this.previousWatchers).forEach(key => {
      this.handles[key].stop();
      delete this.handles[key];
    });
  }

  /**
   * Render our bound friend. Pass them our props, plus our entire state.
   */
  render() {
    const { BoundComponent } = this.constructor;
    const props = { ...this.props, ...this.state };
    return <BoundComponent {...props} />;
  }
}

const noop = function() {
  return {};
};

export function bindComponent(BoundComponent) {
  if (!BoundComponent.subscribe) {
    BoundComponent.subscribe = noop;
  }
  return class Binding extends SPBinding {
    static BoundComponent = BoundComponent;
  };
}
